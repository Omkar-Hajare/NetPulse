import psutil
import socket
import time
import json
from kafka import KafkaProducer
from collections import Counter

PC_ID = socket.gethostname()

producer = KafkaProducer(
    bootstrap_servers="localhost:9092",
    value_serializer=lambda v: json.dumps(v).encode("utf-8")
)

print(f"NetPulse Agent Started on {PC_ID}")


def collect_network_metrics():

    timestamp = time.time()

    # Network IO stats
    net_io = psutil.net_io_counters()

    # System metrics
    cpu_usage = psutil.cpu_percent()
    memory_usage = psutil.virtual_memory().percent

    # Network connections
    connections = psutil.net_connections()

    tcp_count = 0
    udp_count = 0
    remote_ips = set()
    remote_ports = []

    for conn in connections:

        if conn.type == socket.SOCK_STREAM:
            tcp_count += 1
        elif conn.type == socket.SOCK_DGRAM:
            udp_count += 1

        if conn.raddr:
            remote_ips.add(conn.raddr.ip)
            remote_ports.append(conn.raddr.port)

    total_connections = len(connections)
    unique_remote_ips = len(remote_ips)

    # Detect suspicious port access
    suspicious_ports = [22, 23, 3389, 445, 21]
    suspicious_port_access = sum(1 for p in remote_ports if p in suspicious_ports)

    # Detect possible port scanning
    port_counter = Counter(remote_ports)
    potential_port_scan = sum(1 for p in port_counter if port_counter[p] > 10)

    data = {
        "pc_id": PC_ID,
        "timestamp": timestamp,

        # connection metrics
        "total_connections": total_connections,
        "tcp_count": tcp_count,
        "udp_count": udp_count,
        "unique_remote_ips": unique_remote_ips,

        # traffic metrics
        "bytes_sent": net_io.bytes_sent,
        "bytes_received": net_io.bytes_recv,
        "packets_sent": net_io.packets_sent,
        "packets_received": net_io.packets_recv,

        # system metrics
        "cpu_usage": cpu_usage,
        "memory_usage": memory_usage,

        # security indicators
        "suspicious_port_access": suspicious_port_access,
        "potential_port_scan": potential_port_scan
    }

    return data


while True:

    metrics = collect_network_metrics()

    producer.send("network-logs", metrics)
    producer.flush()

    print(f"[{PC_ID}] Metrics sent to Kafka")

    time.sleep(60)