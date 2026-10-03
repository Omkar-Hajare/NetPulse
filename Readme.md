# NetPulse 🚀

**Real-Time Network Monitoring and Security Analytics Platform**

NetPulse is a distributed monitoring system that collects, streams, analyzes, and visualizes system and network activity across multiple computers in real time.
It features **ML-based anomaly detection** using Isolation Forest to automatically identify suspicious network behavior.


# 📌 Project Overview

Modern computer labs and enterprise environments contain multiple connected machines.
Monitoring each system individually is inefficient and security threats can go unnoticed.

NetPulse solves this problem by:

* Collecting system and network metrics from multiple Windows PCs
* Streaming data through Apache Kafka to a central Linux server
* Applying ML anomaly detection (Isolation Forest) on collected data
* Providing real-time dashboards for monitoring and alerting

---

# 🏗️ Architecture

```
   Windows PCs (Agents)               Linux Central Server
  ┌─────────┐ ┌─────────┐          ┌──────────────────────────────┐
  │ PC-01   │ │ PC-02   │          │                              │
  │ Agent   │ │ Agent   │  LAN     │  ┌──────┐    ┌──────────┐   │
  │ psutil  │ │ psutil  │ ──9092──→│  │Kafka │ →  │Consumer  │   │
  └─────────┘ └─────────┘          │  │Broker│    │(→MongoDB)│   │
  ┌─────────┐ ┌─────────┐          │  └──────┘    └──────────┘   │
  │ PC-03   │ │ PC-04   │          │                              │
  │ Agent   │ │ Agent   │──────────│  ┌──────────┐  ┌─────────┐  │
  └─────────┘ └─────────┘          │  │MongoDB   │←→│API      │  │
                                   │  │Database  │  │Server   │  │
       Browsers ──8000──────────→  │  └──────────┘  └─────────┘  │
                                   │                              │
                                   │  ┌──────────┐  ┌─────────┐  │
                                   │  │ML        │  │Dashboard│  │
                                   │  │Analyser  │  │(React)  │  │
                                   │  └──────────┘  └─────────┘  │
                                   └──────────────────────────────┘
```

---

# ⚙️ Features

### System Monitoring
* CPU, memory, disk usage tracking
* System uptime monitoring
* Top process tracking (by CPU usage)

### Network Monitoring
* Real-time traffic statistics (bytes/packets sent/received)
* TCP and UDP connection counts
* Unique remote IP tracking
* Listening port monitoring

### Security & Anomaly Detection
* **ML-based anomaly detection** (Isolation Forest — unsupervised)
* Suspicious port monitoring (21, 22, 23, 445, 3389, etc.)
* Port scan detection
* Windows firewall event log analysis
* Risk scoring per PC (0–100 scale)

### Data Pipeline
* High-throughput streaming using Apache Kafka (KRaft mode)
* Fault-tolerant message processing with batch writes
* Idempotent writes with deduplication

---

# 🛠️ Technology Stack

| Component            | Technology                       |
| -------------------- | -------------------------------- |
| Agent (Windows)      | Python, psutil, pywin32          |
| Message Streaming    | Apache Kafka (KRaft, Docker)     |
| Data Processing      | Kafka Consumer (Python)          |
| Database             | MongoDB 7                        |
| ML Anomaly Detection | scikit-learn (Isolation Forest)  |
| API Server           | FastAPI + Uvicorn                |
| Dashboard            | React + Vite + Recharts          |
| Deployment           | Docker Compose (Linux server)    |

---

# 🚀 Quick Start — Multi-PC Deployment

## Step 1: Setup Central Server (Linux)

```bash
# Clone the repo on your Linux server
git clone https://github.com/Omkar-Hajare/NetPulse.git
cd NetPulse

# Copy and edit the environment file
cp .env.example .env
nano .env  # Set SERVER_IP to your Linux server's LAN IP

# Run the setup script (installs Docker if needed, starts everything)
chmod +x deploy/setup_server.sh
sudo ./deploy/setup_server.sh
```

This starts all services via Docker Compose:
- **Kafka** (port 9092) — message broker
- **MongoDB** (port 27017) — data storage
- **API Server** (port 8000) — REST API
- **Consumer** — writes Kafka → MongoDB
- **ML Analyser** — anomaly detection service

Verify the server is running:
```bash
curl http://localhost:8000/api/health
```

## Step 2: Deploy Agent to Windows PCs

On each Windows PC you want to monitor:

### Option A: PowerShell installer (recommended)
```powershell
# Run as Administrator
.\deploy\install_agent.ps1 -ServerIP 192.168.1.100
# or with a custom PC name:
.\deploy\install_agent.ps1 -ServerIP 192.168.1.100 -PCName "LAB-PC-01"
```

### Option B: Batch file
```cmd
# Run as Administrator
deploy\install_agent.bat 192.168.1.100
# or:
deploy\install_agent.bat 192.168.1.100 LAB-PC-01
```

### Option C: Manual
```cmd
# Set environment variables
set KAFKA_BROKER=192.168.1.100:9092
set PC_ID=MY-PC-NAME
set KAFKA_TOPIC=network-logs

# Install dependencies
pip install psutil kafka-python pywin32

# Start the agent
cd agent
python network_log_agent.py
```

## Step 3: View the Dashboard

Open a browser and navigate to:
```
http://<server-ip>:8000/docs    # API documentation
```

Or run the React dashboard:
```bash
cd dashboard
npm install
npm run dev
```

---

# 🧠 ML Anomaly Detection

NetPulse uses an **Isolation Forest** model for unsupervised anomaly detection.

### How It Works

1. The **ML Analyser** service runs in the background
2. It collects log data from MongoDB and extracts 13 features:
   - CPU, memory, disk usage
   - Network traffic (bytes sent/received, ratio)
   - Connection metrics (total, unique IPs)
   - Security indicators (suspicious ports, port scans, firewall blocks)
3. The model is auto-trained when 50+ log entries are available
4. Each new log is scored on a **0–100 risk scale**
5. Anomalies generate alerts visible in the dashboard

### Manual Training

```bash
# Train on all available data
python ml/train_model.py

# Train on last 7 days only
python ml/train_model.py --hours 168

# Adjust anomaly sensitivity (default: 5%)
python ml/train_model.py --contamination 0.10

# Generate synthetic training data first
python ml/train_model.py --generate-synthetic --synthetic-samples 1000
```

### Model Output

Training produces three files in `ml/models/`:
- `anomaly_model.pkl` — trained Isolation Forest
- `scaler.pkl` — fitted StandardScaler
- `model_metadata.json` — training stats and hyperparameters

---

# 📊 API Endpoints

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/health` | GET | Health check + ML status |
| `/api/pcs` | GET | List all monitored PC IDs |
| `/api/pcs/status` | GET | Online/offline status per PC |
| `/api/summaries` | GET | Per-PC summary (latest metrics) |
| `/api/overview` | GET | Fleet-wide aggregated KPIs |
| `/api/pcs/{id}/latest` | GET | Latest snapshot for a PC |
| `/api/pcs/{id}/history` | GET | Time-series data for a PC |
| `/api/pcs/{id}/risk` | GET | ML risk score + anomaly history |
| `/api/fleet/history` | GET | Aggregated fleet time-series |
| `/api/alerts` | GET | Security & anomaly alerts |
| `/api/anomalies` | GET | ML-detected anomalies only |
| `/api/ml/status` | GET | Model training metadata |
| `/api/security/threat-ips` | GET | Blocked IP aggregation |
| `/api/stats` | GET | Global stats over time range |

---

# 📁 Project Structure

```
NetPulse/
├── agent/                      # Windows agent (runs on each PC)
│   ├── network_log_agent.py    # Main collector script
│   ├── requirements.txt
│   └── start_agent.bat
│
├── server/                     # Central server services
│   ├── api.py                  # FastAPI REST API
│   ├── kafka_consumer.py       # Kafka → MongoDB writer
│   ├── analyser.py             # ML anomaly detection service
│   ├── config.py               # Shared configuration
│   ├── Dockerfile              # Docker image for all services
│   ├── requirements.txt
│   └── start_server.sh         # Manual startup script (WSL)
│
├── ml/                         # Machine learning
│   ├── train_model.py          # Model training script
│   ├── models/                 # Saved model artifacts
│   └── requirements.txt
│
├── dashboard/                  # React frontend
│   ├── src/
│   │   ├── pages/              # Overview, PCDetail, Security
│   │   ├── components/         # Sidebar, Header
│   │   └── api.js              # API client functions
│   └── ...
│
├── deploy/                     # Deployment scripts
│   ├── setup_server.sh         # Linux server auto-setup
│   ├── install_agent.ps1       # Windows agent installer
│   └── install_agent.bat       # Batch wrapper
│
├── docker-compose.yml          # Full stack deployment
├── .env.example                # Environment config template
└── Readme.md
```

---

# 🔧 Docker Compose Services

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Stop all services
docker compose down

# Rebuild after code changes
docker compose build && docker compose up -d
```

| Service    | Container Name       | Port  | Purpose                     |
| ---------- | -------------------- | ----- | --------------------------- |
| kafka      | netpulse-kafka       | 9092  | Message broker              |
| mongodb    | netpulse-mongodb     | 27017 | Data storage                |
| consumer   | netpulse-consumer    | —     | Kafka → MongoDB writer      |
| api        | netpulse-api         | 8000  | REST API server             |
| analyser   | netpulse-analyser    | —     | ML anomaly detection        |

---

# 🔒 Security Capabilities

* Suspicious port monitoring (FTP, SSH, Telnet, SMB, RDP)
* Port scan detection (>5 unique IPs on same port)
* Windows firewall event log analysis
* ML anomaly detection with risk scoring
* Real-time alerting (critical/warning/info levels)
* Blocked IP aggregation across fleet

---

# 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit changes: `git commit -m 'Add my feature'`
4. Push to branch: `git push origin feature/my-feature`
5. Open a Pull Request
