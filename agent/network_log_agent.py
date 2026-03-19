import psutil
import socket
import time
import json
import logging
import signal
import sys
import os
from kafka import KafkaProducer
from kafka.errors import KafkaError, NoBrokersAvailable
from collections import Counter

# ─── Configuration ────────────────────────────────────────────────────────────

KAFKA_BROKER      = os.getenv("KAFKA_BROKER", "localhost:9092")
KAFKA_TOPIC       = os.getenv("KAFKA_TOPIC", "network-logs")
INTERVAL          = int(os.getenv("COLLECT_INTERVAL", "60"))
PC_ID             = os.getenv("PC_ID", socket.gethostname())
LOG_FILE          = os.getenv("LOG_FILE", "netpulse_agent.log")
FIREWALL_LOOKBACK = INTERVAL + 5
TOP_PROCESS_COUNT = 3   # how many top CPU processes to report

SUSPICIOUS_PORTS  = {21, 22, 23, 445, 3389, 4444, 5900, 6667}

# Windows pseudo-processes — excluded from top_processes
FILTER_PROCESSES  = {"system idle process", "system", "idle", "registry"}

# ─── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("netpulse-agent")

# ─── Firewall log collection (Windows Event Log) ──────────────────────────────
#
# Read pointer is persisted to a file so restarts never re-read old events.
# Each cycle saves the current UTC time to .firewall_state — next cycle reads
# only events that happened after that timestamp.

_FIREWALL_STATE_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    ".firewall_state"
)


def _load_last_firewall_read():
    """Load last read timestamp from disk. Returns None if file missing."""
    try:
        from datetime import datetime, timezone
        with open(_FIREWALL_STATE_FILE, "r") as f:
            ts = datetime.fromisoformat(f.read().strip())
            # Ensure timezone-aware
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            return ts
    except Exception:
        return None


def _save_last_firewall_read(dt):
    """Persist last read timestamp to disk."""
    try:
        with open(_FIREWALL_STATE_FILE, "w") as f:
            f.write(dt.isoformat())
    except Exception as e:
        log.warning(f"Could not save firewall state: {e}")


def _ensure_firewall_auditing():
    try:
        import subprocess
        subprocess.run(
            ["auditpol", "/set",
             "/subcategory:Filtering Platform Connection",
             "/success:enable", "/failure:enable"],
            capture_output=True, check=True
        )
        log.info("Windows firewall auditing confirmed enabled.")
    except Exception as e:
        log.warning(f"Could not enable firewall auditing (need admin?): {e}")


def collect_firewall_events(lookback_seconds: int) -> dict:
    empty = {
        "blocked_count":  0,
        "allowed_count":  0,
        "blocked_ips":    [],
        "blocked_ports":  [],
        "top_blocked_ip": None,
    }
    try:
        import win32evtlog
        from datetime import datetime, timezone, timedelta
    except ImportError:
        log.debug("pywin32 not available — skipping firewall events.")
        return empty

    blocked_ips   = []
    blocked_ports = []
    allowed_count = 0
    blocked_count = 0

    now       = datetime.now(timezone.utc)
    last_read = _load_last_firewall_read()

    # First run ever → read last N seconds as a warm-up window
    # Every subsequent run → read only events since last successful read
    cutoff = last_read if last_read else \
             now - timedelta(seconds=lookback_seconds)

    log.debug(f"Firewall read window: {cutoff.isoformat()} → {now.isoformat()}")

    handle = None
    try:
        handle = win32evtlog.OpenEventLog(None, "Security")
        flags  = (win32evtlog.EVENTLOG_BACKWARDS_READ |
                  win32evtlog.EVENTLOG_SEQUENTIAL_READ)
        while True:
            events = win32evtlog.ReadEventLog(handle, flags, 0)
            if not events:
                break
            for event in events:
                event_time = event.TimeGenerated.replace(tzinfo=timezone.utc)
                if event_time <= cutoff:
                    raise StopIteration   # passed our window — stop reading
                event_id = event.EventID & 0xFFFF
                if event_id == 5157:      # BLOCKED
                    blocked_count += 1
                    strings = event.StringInserts or []
                    if len(strings) >= 7:
                        dst_ip   = strings[5]
                        dst_port = _safe_int(strings[6])
                        if dst_ip and dst_ip not in ("", "-", "::"):
                            blocked_ips.append(dst_ip)
                        if dst_port:
                            blocked_ports.append(dst_port)
                elif event_id == 5156:    # ALLOWED
                    allowed_count += 1

    except StopIteration:
        pass
    except Exception as e:
        log.warning(f"Could not read Windows Event Log: {e}")
        return empty
    finally:
        if handle:
            try:
                win32evtlog.CloseEventLog(handle)
            except Exception:
                pass

    top_blocked_ip = None
    if blocked_ips:
        top_blocked_ip = Counter(blocked_ips).most_common(1)[0][0]

    # Persist read pointer — survives agent restarts
    _save_last_firewall_read(now)

    return {
        "blocked_count":  blocked_count,
        "allowed_count":  allowed_count,
        "blocked_ips":    list(set(blocked_ips))[:20],
        "blocked_ports":  list(set(blocked_ports))[:20],
        "top_blocked_ip": top_blocked_ip,
    }


def _safe_int(value):
    try:
        return int(value)
    except (ValueError, TypeError):
        return None

# ─── Kafka producer ───────────────────────────────────────────────────────────

def create_producer(retries=5, delay=5):
    for attempt in range(1, retries + 1):
        try:
            producer = KafkaProducer(
                bootstrap_servers=KAFKA_BROKER,
                value_serializer=lambda v: json.dumps(v).encode("utf-8"),
                acks="all",
                retries=3,
                linger_ms=100,
            )
            log.info(f"Connected to Kafka broker at {KAFKA_BROKER}")
            return producer
        except NoBrokersAvailable:
            log.warning(
                f"Kafka not reachable (attempt {attempt}/{retries}). "
                f"Retrying in {delay}s..."
            )
            time.sleep(delay)
    log.error("Could not connect to Kafka. Exiting.")
    sys.exit(1)

# ─── Delta tracker ────────────────────────────────────────────────────────────

_prev_net_io   = None
_prev_timestamp = None

def get_net_io_delta():
    global _prev_net_io, _prev_timestamp
    current = psutil.net_io_counters()
    now     = time.time()

    if _prev_net_io is None:
        _prev_net_io    = current
        _prev_timestamp = now
        return {
            "bytes_sent": 0, "bytes_received": 0,
            "packets_sent": 0, "packets_received": 0,
        }

    # Handle counter reset on system reboot mid-run
    if current.bytes_sent < _prev_net_io.bytes_sent:
        _prev_net_io    = current
        _prev_timestamp = now
        return {
            "bytes_sent": 0, "bytes_received": 0,
            "packets_sent": 0, "packets_received": 0,
        }

    delta = {
        "bytes_sent":       current.bytes_sent   - _prev_net_io.bytes_sent,
        "bytes_received":   current.bytes_recv   - _prev_net_io.bytes_recv,
        "packets_sent":     current.packets_sent - _prev_net_io.packets_sent,
        "packets_received": current.packets_recv - _prev_net_io.packets_recv,
    }
    _prev_net_io    = current
    _prev_timestamp = now
    return delta

# ─── System metrics ───────────────────────────────────────────────────────────

def collect_system_metrics() -> dict:
    cpu_usage    = psutil.cpu_percent(interval=1)
    memory_usage = psutil.virtual_memory().percent

    # Disk usage on primary drive
    try:
        disk = psutil.disk_usage("C:\\" if sys.platform == "win32" else "/")
        disk_usage = round(disk.percent, 1)
    except Exception:
        disk_usage = 0.0

    # Uptime in seconds
    uptime_seconds = int(time.time() - psutil.boot_time())

    return {
        "cpu_usage":      cpu_usage,
        "memory_usage":   memory_usage,
        "disk_usage":     disk_usage,
        "uptime_seconds": uptime_seconds,
    }

# ─── Network interface speed ──────────────────────────────────────────────────

def get_interface_speed() -> int:
    """Return the speed (Mbps) of the fastest active non-loopback interface."""
    try:
        stats = psutil.net_if_stats()
        speed = 0
        for iface, s in stats.items():
            if s.isup and s.speed > 0 and "loopback" not in iface.lower():
                speed = max(speed, s.speed)
        return speed
    except Exception:
        return 0

# ─── Connection metrics ───────────────────────────────────────────────────────

def collect_connection_metrics() -> dict:
    tcp_count    = 0
    udp_count    = 0
    remote_ips   = set()
    remote_ports = []
    listening_ports = []

    try:
        connections = psutil.net_connections(kind="all")
        for conn in connections:
            if conn.type == socket.SOCK_STREAM:
                tcp_count += 1
                # Track listening ports separately
                if conn.status == "LISTEN" and conn.laddr:
                    listening_ports.append(conn.laddr.port)
            elif conn.type == socket.SOCK_DGRAM:
                udp_count += 1
            if conn.raddr:
                remote_ips.add(conn.raddr.ip)
                remote_ports.append(conn.raddr.port)
    except psutil.AccessDenied:
        log.warning("Access denied reading net_connections.")

    suspicious_port_access = sum(
        1 for p in remote_ports if p in SUSPICIOUS_PORTS
    )

    # Port scan detection: >5 unique remote IPs hitting the same local port
    port_ip_groups = {}
    try:
        for conn in psutil.net_connections(kind="all"):
            if conn.raddr and conn.laddr:
                port_ip_groups.setdefault(
                    conn.laddr.port, set()
                ).add(conn.raddr.ip)
    except psutil.AccessDenied:
        pass

    potential_port_scan = sum(
        1 for ips in port_ip_groups.values() if len(ips) > 5
    )

    return {
        "tcp_count":              tcp_count,
        "udp_count":              udp_count,
        "total_connections":      tcp_count + udp_count,
        "unique_remote_ips":      len(remote_ips),
        "listening_ports":        sorted(set(listening_ports)),
        "listening_port_count":   len(set(listening_ports)),
        "suspicious_port_access": suspicious_port_access,
        "potential_port_scan":    potential_port_scan,
    }

# ─── Process metrics ──────────────────────────────────────────────────────────

def collect_process_metrics() -> dict:
    """
    Returns total process count and top N processes by CPU usage.
    Uses oneshot() for efficiency — reads all proc attributes in one syscall.
    Filters out Windows pseudo-processes (System Idle, System, Registry).
    """
    processes = []
    total     = 0

    for proc in psutil.process_iter(["name", "cpu_percent", "memory_percent"]):
        try:
            with proc.oneshot():
                name = proc.info["name"] or "unknown"

                # Skip Windows kernel/idle pseudo-processes
                if name.lower() in FILTER_PROCESSES:
                    continue

                total += 1
                processes.append({
                    "name":   name,
                    "cpu":    round(proc.info["cpu_percent"] or 0.0, 1),
                    "memory": round(proc.info["memory_percent"] or 0.0, 1),
                })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    top = sorted(processes, key=lambda p: p["cpu"], reverse=True)
    return {
        "total_processes": total,
        "top_processes":   top[:TOP_PROCESS_COUNT],
    }

# ─── Master collector ─────────────────────────────────────────────────────────

def collect_metrics() -> dict:
    timestamp = time.time()

    system      = collect_system_metrics()
    net_delta   = get_net_io_delta()
    connections = collect_connection_metrics()
    processes   = collect_process_metrics()
    firewall    = collect_firewall_events(FIREWALL_LOOKBACK)
    iface_speed = get_interface_speed()

    return {
        # ── Identity ──────────────────────────────
        "pc_id":     PC_ID,
        "timestamp": timestamp,

        # ── System health ─────────────────────────
        "cpu_usage":      system["cpu_usage"],
        "memory_usage":   system["memory_usage"],
        "disk_usage":     system["disk_usage"],
        "uptime_seconds": system["uptime_seconds"],

        # ── Network traffic (delta per interval) ──
        "bytes_sent":          net_delta["bytes_sent"],
        "bytes_received":      net_delta["bytes_received"],
        "packets_sent":        net_delta["packets_sent"],
        "packets_received":    net_delta["packets_received"],
        "interface_speed_mbps": iface_speed,

        # ── Connections ───────────────────────────
        "tcp_count":            connections["tcp_count"],
        "udp_count":            connections["udp_count"],
        "total_connections":    connections["total_connections"],
        "unique_remote_ips":    connections["unique_remote_ips"],
        "listening_ports":      connections["listening_ports"],
        "listening_port_count": connections["listening_port_count"],

        # ── Security indicators ───────────────────
        "suspicious_port_access": connections["suspicious_port_access"],
        "potential_port_scan":    connections["potential_port_scan"],

        # ── Processes ─────────────────────────────
        "total_processes": processes["total_processes"],
        "top_processes":   processes["top_processes"],

        # ── Firewall (Windows Event Log) ──────────
        "firewall": firewall,
    }

# ─── Graceful shutdown ────────────────────────────────────────────────────────

_running = True

def handle_signal(signum, frame):
    global _running
    log.info(f"Signal {signum} received. Shutting down...")
    _running = False

signal.signal(signal.SIGINT,  handle_signal)
signal.signal(signal.SIGTERM, handle_signal)

# ─── Entry point ──────────────────────────────────────────────────────────────

def main():
    log.info(f"NetPulse Agent starting on {PC_ID}")
    log.info(f"Broker: {KAFKA_BROKER} | Topic: {KAFKA_TOPIC} | Interval: {INTERVAL}s")

    _ensure_firewall_auditing()
    producer = create_producer()

    while _running:
        try:
            metrics = collect_metrics()
            fw      = metrics["firewall"]

            future = producer.send(KAFKA_TOPIC, metrics)
            future.get(timeout=10)
            producer.flush()

            log.info(
                f"[{PC_ID}] Sent — "
                f"cpu={metrics['cpu_usage']}% "
                f"mem={metrics['memory_usage']}% "
                f"disk={metrics['disk_usage']}% "
                f"conns={metrics['total_connections']} "
                f"procs={metrics['total_processes']} "
                f"listen={metrics['listening_port_count']} ports "
                f"fw_blocked={fw['blocked_count']} "
                f"fw_allowed={fw['allowed_count']}"
            )

        except KafkaError as e:
            log.error(f"Kafka send error: {e}. Will retry next cycle.")
        except Exception as e:
            log.exception(f"Unexpected error: {e}")

        for _ in range(INTERVAL):
            if not _running:
                break
            time.sleep(1)

    log.info("Flushing and closing producer...")
    producer.flush()
    producer.close()
    log.info("Agent stopped cleanly.")


if __name__ == "__main__":
    main()