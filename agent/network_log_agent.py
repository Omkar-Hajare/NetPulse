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

KAFKA_BROKER   = os.getenv("KAFKA_BROKER", "localhost:9092")
KAFKA_TOPIC    = os.getenv("KAFKA_TOPIC", "network-logs")
INTERVAL       = int(os.getenv("COLLECT_INTERVAL", "60"))   # seconds
PC_ID          = os.getenv("PC_ID", socket.gethostname())
LOG_FILE       = os.getenv("LOG_FILE", "netpulse_agent.log")

SUSPICIOUS_PORTS = {21, 22, 23, 445, 3389, 4444, 5900, 6667}

# ─── Logging setup ────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("netpulse-agent")

# ─── Kafka producer (with retry) ──────────────────────────────────────────────

def create_producer(retries=5, delay=5):
    """Try to connect to Kafka, retrying on failure."""
    for attempt in range(1, retries + 1):
        try:
            producer = KafkaProducer(
                bootstrap_servers=KAFKA_BROKER,
                value_serializer=lambda v: json.dumps(v).encode("utf-8"),
                acks="all",                  # wait for full replication
                retries=3,                   # let kafka-python retry sends
                linger_ms=100,              # small batching window
            )
            log.info(f"Connected to Kafka broker at {KAFKA_BROKER}")
            return producer
        except NoBrokersAvailable:
            log.warning(f"Kafka not reachable (attempt {attempt}/{retries}). Retrying in {delay}s...")
            time.sleep(delay)
    log.error("Could not connect to Kafka after multiple attempts. Exiting.")
    sys.exit(1)

# ─── Delta tracker ────────────────────────────────────────────────────────────

_prev_net_io = None  # tracks last snapshot for delta calculation

def get_net_io_delta():
    """Return bytes/packets since the last call (not cumulative totals)."""
    global _prev_net_io
    current = psutil.net_io_counters()

    if _prev_net_io is None:
        # First call — no delta available yet, return zeros
        _prev_net_io = current
        return {
            "bytes_sent":     0,
            "bytes_received": 0,
            "packets_sent":   0,
            "packets_received": 0,
        }

    delta = {
        "bytes_sent":       max(0, current.bytes_sent    - _prev_net_io.bytes_sent),
        "bytes_received":   max(0, current.bytes_recv    - _prev_net_io.bytes_recv),
        "packets_sent":     max(0, current.packets_sent  - _prev_net_io.packets_sent),
        "packets_received": max(0, current.packets_recv  - _prev_net_io.packets_recv),
    }
    _prev_net_io = current
    return delta

# ─── Metric collection ────────────────────────────────────────────────────────

def collect_metrics():
    timestamp = time.time()

    # System metrics
    cpu_usage    = psutil.cpu_percent(interval=1)
    memory_usage = psutil.virtual_memory().percent

    # Network IO (delta since last interval)
    net_delta = get_net_io_delta()

    # Connection analysis (gracefully handle permission errors)
    tcp_count    = 0
    udp_count    = 0
    remote_ips   = set()
    remote_ports = []

    try:
        connections = psutil.net_connections(kind="all")
        for conn in connections:
            if conn.type == socket.SOCK_STREAM:
                tcp_count += 1
            elif conn.type == socket.SOCK_DGRAM:
                udp_count += 1
            if conn.raddr:
                remote_ips.add(conn.raddr.ip)
                remote_ports.append(conn.raddr.port)
    except psutil.AccessDenied:
        log.warning("Access denied reading net_connections — run as root for full data.")

    total_connections  = tcp_count + udp_count
    unique_remote_ips  = len(remote_ips)

    # Security indicators
    suspicious_port_access = sum(1 for p in remote_ports if p in SUSPICIOUS_PORTS)

    # Port scan detection: >5 unique remote IPs on the same port within one snapshot
    port_ip_groups: dict[int, set] = {}
    try:
        for conn in psutil.net_connections(kind="all"):
            if conn.raddr and conn.laddr:
                port_ip_groups.setdefault(conn.laddr.port, set()).add(conn.raddr.ip)
    except psutil.AccessDenied:
        pass

    potential_port_scan = sum(
        1 for ips in port_ip_groups.values() if len(ips) > 5
    )

    return {
        "pc_id":     PC_ID,
        "timestamp": timestamp,
        # connection metrics
        "total_connections":   total_connections,
        "tcp_count":           tcp_count,
        "udp_count":           udp_count,
        "unique_remote_ips":   unique_remote_ips,
        # traffic metrics (delta per interval, not cumulative)
        **net_delta,
        # system metrics
        "cpu_usage":    cpu_usage,
        "memory_usage": memory_usage,
        # security indicators
        "suspicious_port_access": suspicious_port_access,
        "potential_port_scan":    potential_port_scan,
    }

# ─── Graceful shutdown ────────────────────────────────────────────────────────

_running = True

def handle_signal(signum, frame):
    global _running
    log.info(f"Signal {signum} received. Shutting down agent...")
    _running = False

signal.signal(signal.SIGINT,  handle_signal)
signal.signal(signal.SIGTERM, handle_signal)

# ─── Main loop ────────────────────────────────────────────────────────────────

def main():
    log.info(f"NetPulse Agent starting on {PC_ID}")
    log.info(f"Broker: {KAFKA_BROKER} | Topic: {KAFKA_TOPIC} | Interval: {INTERVAL}s")

    producer = create_producer()

    while _running:
        try:
            metrics = collect_metrics()

            future = producer.send(KAFKA_TOPIC, metrics)
            future.get(timeout=10)   # block briefly to catch send errors
            producer.flush()

            log.info(
                f"[{PC_ID}] Sent — cpu={metrics['cpu_usage']}% "
                f"mem={metrics['memory_usage']}% "
                f"conns={metrics['total_connections']} "
                f"rx={metrics['bytes_received']}B "
                f"tx={metrics['bytes_sent']}B"
            )

        except KafkaError as e:
            log.error(f"Kafka send error: {e}. Will retry next cycle.")
        except Exception as e:
            log.exception(f"Unexpected error during metric collection: {e}")

        # Interruptible sleep — checks _running flag every second
        for _ in range(INTERVAL):
            if not _running:
                break
            time.sleep(1)

    log.info("Flushing producer and closing connection...")
    producer.flush()
    producer.close()
    log.info("Agent stopped cleanly.")


if __name__ == "__main__":
    main()