# NetPulse 🚀

**Real-Time Network Monitoring and Security Analytics Platform**

NetPulse is a lightweight distributed monitoring system designed to collect, stream, analyze, and visualize system and network activity across multiple computers in real time.
It helps administrators monitor system health, detect suspicious network behavior, and gain insights into network activity through centralized dashboards.

---

# 📌 Project Overview

Modern computer labs and enterprise environments contain multiple connected machines.
Monitoring each system individually is inefficient and security threats can go unnoticed.

NetPulse solves this problem by:

* Collecting system and network metrics from multiple PCs
* Streaming the data through a scalable pipeline
* Storing logs centrally for analysis
* Providing insights for monitoring and anomaly detection

---

# 🏗️ Architecture

Client machines run a **NetPulse Agent** that collects system and network metrics.
The collected logs are streamed to a **Kafka broker**, processed by a **consumer service**, and stored in **MongoDB** for further analysis and visualization.

```
Client PCs
   │
   │  NetPulse Agent (Python)
   ▼
Kafka Producer
   │
   ▼
Kafka Broker
   │
   ▼
Kafka Consumer
   │
   ▼
MongoDB Database
   │
   ▼
Monitoring Dashboard
(Grafana / Analytics)
```

---

# ⚙️ Features

### System Monitoring

* CPU usage tracking
* Memory usage monitoring
* System uptime
* Disk usage

### Network Monitoring

* Network traffic statistics
* TCP and UDP connection counts
* Unique remote IP tracking
* Network packet statistics

### Security Monitoring

* Detection of suspicious ports
* Potential port scan detection
* Firewall log analysis (optional)
* Connection anomaly detection

### Data Pipeline

* High-throughput streaming using Apache Kafka
* Fault-tolerant message processing
* Batch database writes for efficiency

---

# 📊 Metrics Collected

The NetPulse agent collects the following metrics:

| Category         | Metrics                                      |
| ---------------- | -------------------------------------------- |
| System           | CPU usage, memory usage                      |
| Network          | bytes sent/received, packets sent/received   |
| Connections      | TCP connections, UDP connections             |
| Security         | suspicious port access, potential port scans |
| Network analysis | unique remote IP addresses                   |

Example log message:

```json
{
 "pc_id": "LAB-PC-01",
 "timestamp": 1710523000,
 "cpu_usage": 23,
 "memory_usage": 42,
 "total_connections": 35,
 "tcp_count": 25,
 "udp_count": 10,
 "unique_remote_ips": 6,
 "bytes_sent": 20000,
 "bytes_received": 30000,
 "suspicious_port_access": 1,
 "potential_port_scan": 0
}
```

---

# 🛠️ Technology Stack

| Component         | Technology              |
| ----------------- | ----------------------- |
| Data Collection   | Python, psutil          |
| Message Streaming | Apache Kafka            |
| Data Processing   | Kafka Consumer (Python) |
| Database          | MongoDB                 |
| Visualization     | Grafana (optional)      |
| OS Environment    | Ubuntu / Linux          |

---

# 📦 Installation

## 1. Clone the Repository

```
git clone https://github.com/yourusername/netpulse.git
cd netpulse
```

---

## 2. Install Python Dependencies

```
pip install psutil kafka-python pymongo
```

---

## 3. Start Kafka

Make sure Kafka is running.

```
bin/kafka-server-start.sh config/server.properties
```

Create topic:

```
bin/kafka-topics.sh --create \
--topic network-logs \
--bootstrap-server localhost:9092
```

---

# 🚀 Running the System

## Step 1 — Start the Kafka Consumer

This service reads logs from Kafka and stores them in MongoDB.

```
python consumer.py
```

---

## Step 2 — Start NetPulse Agent on Client PCs

Run the collector script on each monitored machine.

```
python agent.py
```

Each agent will begin sending metrics to the Kafka server.

---



# 🔒 Security Capabilities

NetPulse includes basic network threat detection:

* Suspicious port monitoring
* Port scan detection
* Abnormal connection tracking
* Firewall event monitoring (optional)

These features provide early indicators of potential network attacks.

