#!/bin/bash
# ──────────────────────────────────────────────────────────────────────
# NetPulse Server Startup Script (WSL / Ubuntu — KRaft mode)
# Starts: MongoDB → Kafka (KRaft) → Consumer → API Server
# ──────────────────────────────────────────────────────────────────────

set -e

# Adjust these paths to match your setup
KAFKA_HOME="${KAFKA_HOME:-$HOME/kafka}"
NETPULSE_DIR="/mnt/c/ProgramData/NetPulse"
VENV_DIR="${NETPULSE_DIR}/venv"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}   NetPulse Server Startup (KRaft)${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"

# ─── 1. Start MongoDB ────────────────────────────────────────────────
echo -e "\n${YELLOW}[1/4] Starting MongoDB...${NC}"
if pgrep -x mongod &>/dev/null; then
    echo -e "  ${GREEN}✓ MongoDB already running${NC}"
else
    sudo systemctl start mongod
    sleep 2
    if pgrep -x mongod &>/dev/null; then
        echo -e "  ${GREEN}✓ MongoDB started${NC}"
    else
        echo -e "  ${RED}✗ Failed to start MongoDB${NC}"
        exit 1
    fi
fi

# ─── 2. Start Kafka (KRaft — no Zookeeper needed) ────────────────────
echo -e "\n${YELLOW}[2/4] Starting Kafka (KRaft mode)...${NC}"
if echo "" | timeout 2 nc -z localhost 9092 2>/dev/null; then
    echo -e "  ${GREEN}✓ Kafka already running on port 9092${NC}"
else
    echo -e "  Starting Kafka..."
    cd "$KAFKA_HOME"
    bin/kafka-server-start.sh -daemon config/kraft/server.properties
    sleep 5
    if echo "" | timeout 2 nc -z localhost 9092 2>/dev/null; then
        echo -e "  ${GREEN}✓ Kafka started (KRaft)${NC}"
    else
        echo -e "  ${RED}✗ Kafka failed to start. Run manually:${NC}"
        echo -e "    cd $KAFKA_HOME"
        echo -e "    bin/kafka-server-start.sh config/kraft/server.properties"
        exit 1
    fi
fi

# ─── 3. Activate venv & start Consumer ───────────────────────────────
echo -e "\n${YELLOW}[3/4] Starting Kafka Consumer...${NC}"
cd "$NETPULSE_DIR"
if [ -d "$VENV_DIR" ]; then
    source "$VENV_DIR/bin/activate"
    echo -e "  ${GREEN}✓ Virtual env activated${NC}"
else
    echo -e "  ${YELLOW}No venv found at $VENV_DIR — using system Python${NC}"
fi

cd "$NETPULSE_DIR/server"
if pgrep -f "kafka_consumer.py" &>/dev/null; then
    echo -e "  ${GREEN}✓ Consumer already running${NC}"
else
    python3 kafka_consumer.py &
    CONSUMER_PID=$!
    echo -e "  ${GREEN}✓ Consumer started (PID: $CONSUMER_PID)${NC}"
fi

# ─── 4. Start API Server ─────────────────────────────────────────────
echo -e "\n${YELLOW}[4/4] Starting API Server...${NC}"
if pgrep -f "uvicorn.*api:app" &>/dev/null; then
    echo -e "  ${GREEN}✓ API server already running${NC}"
else
    python3 -m uvicorn api:app --host 0.0.0.0 --port 8000 --reload &
    API_PID=$!
    echo -e "  ${GREEN}✓ API server started on http://0.0.0.0:8000 (PID: $API_PID)${NC}"
fi

echo -e "\n${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}   All services running!${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo ""
echo "  API Health:  http://localhost:8000/api/health"
echo "  API Docs:    http://localhost:8000/docs"
echo ""
echo "  Press Ctrl+C to stop all services."

trap "echo 'Stopping...'; kill 0; exit 0" SIGINT SIGTERM
wait
