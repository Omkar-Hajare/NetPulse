#!/bin/bash
# ──────────────────────────────────────────────────────────────────────
# NetPulse — Central Server Setup Script (Linux)
#
# Prepares the Linux server to run the NetPulse backend.
# This handles both Docker-based and manual setups.
#
# USAGE:
#   chmod +x deploy/setup_server.sh
#   sudo ./deploy/setup_server.sh
# ──────────────────────────────────────────────────────────────────────

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo -e "${CYAN}   NetPulse Central Server Setup${NC}"
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo ""

# ─── Detect server IP ────────────────────────────────────────────────
SERVER_IP=$(hostname -I | awk '{print $1}')
echo -e "${YELLOW}Detected server IP: ${GREEN}${SERVER_IP}${NC}"
echo -e "${YELLOW}Windows agents will connect to: ${GREEN}${SERVER_IP}:9092${NC}"
echo ""

# ─── Check Docker ────────────────────────────────────────────────────
echo -e "${YELLOW}[1/5] Checking Docker...${NC}"
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version)
    echo -e "  ${GREEN}✓ $DOCKER_VERSION${NC}"
else
    echo -e "  ${RED}✗ Docker not found. Installing...${NC}"
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
    echo -e "  ${GREEN}✓ Docker installed${NC}"
fi

if command -v docker compose &> /dev/null; then
    echo -e "  ${GREEN}✓ Docker Compose available${NC}"
elif command -v docker-compose &> /dev/null; then
    echo -e "  ${GREEN}✓ docker-compose available${NC}"
else
    echo -e "  ${RED}✗ Docker Compose not found. Installing plugin...${NC}"
    sudo apt-get update && sudo apt-get install -y docker-compose-plugin
    echo -e "  ${GREEN}✓ Docker Compose installed${NC}"
fi

# ─── Configure firewall ──────────────────────────────────────────────
echo -e "\n${YELLOW}[2/5] Configuring firewall...${NC}"
if command -v ufw &> /dev/null; then
    sudo ufw allow 9092/tcp comment "NetPulse Kafka" 2>/dev/null || true
    sudo ufw allow 27017/tcp comment "NetPulse MongoDB" 2>/dev/null || true
    sudo ufw allow 8000/tcp comment "NetPulse API" 2>/dev/null || true
    sudo ufw allow 5173/tcp comment "NetPulse Dashboard" 2>/dev/null || true
    echo -e "  ${GREEN}✓ Ports opened: 9092, 27017, 8000, 5173${NC}"
elif command -v firewall-cmd &> /dev/null; then
    sudo firewall-cmd --permanent --add-port=9092/tcp 2>/dev/null || true
    sudo firewall-cmd --permanent --add-port=27017/tcp 2>/dev/null || true
    sudo firewall-cmd --permanent --add-port=8000/tcp 2>/dev/null || true
    sudo firewall-cmd --permanent --add-port=5173/tcp 2>/dev/null || true
    sudo firewall-cmd --reload 2>/dev/null || true
    echo -e "  ${GREEN}✓ Ports opened: 9092, 27017, 8000, 5173${NC}"
else
    echo -e "  ${YELLOW}⚠ No firewall manager detected. Ensure ports 9092, 27017, 8000 are open.${NC}"
fi

# ─── Create .env file ────────────────────────────────────────────────
echo -e "\n${YELLOW}[3/5] Creating configuration...${NC}"
NETPULSE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$NETPULSE_DIR/.env" ]; then
    cp "$NETPULSE_DIR/.env.example" "$NETPULSE_DIR/.env"
    sed -i "s/SERVER_IP=.*/SERVER_IP=${SERVER_IP}/" "$NETPULSE_DIR/.env"
    echo -e "  ${GREEN}✓ .env created with SERVER_IP=${SERVER_IP}${NC}"
else
    echo -e "  ${YELLOW}⚠ .env already exists — updating SERVER_IP${NC}"
    sed -i "s/SERVER_IP=.*/SERVER_IP=${SERVER_IP}/" "$NETPULSE_DIR/.env"
fi

# ─── Build and start containers ──────────────────────────────────────
echo -e "\n${YELLOW}[4/5] Starting services with Docker Compose...${NC}"
cd "$NETPULSE_DIR"
docker compose build
docker compose up -d

echo -e "  ${GREEN}✓ All services starting...${NC}"
echo ""

# Wait for services to be healthy
echo -e "${YELLOW}[5/5] Waiting for services...${NC}"
sleep 10

# Check each service
echo -en "  Kafka:    "
if docker compose ps kafka | grep -q "running\|Up"; then
    echo -e "${GREEN}✓ Running${NC}"
else
    echo -e "${RED}✗ Not running${NC}"
fi

echo -en "  MongoDB:  "
if docker compose ps mongodb | grep -q "running\|Up"; then
    echo -e "${GREEN}✓ Running${NC}"
else
    echo -e "${RED}✗ Not running${NC}"
fi

echo -en "  Consumer: "
if docker compose ps consumer | grep -q "running\|Up"; then
    echo -e "${GREEN}✓ Running${NC}"
else
    echo -e "${RED}✗ Not running${NC}"
fi

echo -en "  API:      "
if docker compose ps api | grep -q "running\|Up"; then
    echo -e "${GREEN}✓ Running${NC}"
else
    echo -e "${RED}✗ Not running${NC}"
fi

echo -en "  Analyser: "
if docker compose ps analyser | grep -q "running\|Up"; then
    echo -e "${GREEN}✓ Running${NC}"
else
    echo -e "${RED}✗ Not running${NC}"
fi

# ─── Summary ─────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo -e "${CYAN}   Setup Complete!${NC}"
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo ""
echo -e "  Server IP:        ${GREEN}${SERVER_IP}${NC}"
echo -e "  Kafka broker:     ${GREEN}${SERVER_IP}:9092${NC}"
echo -e "  MongoDB:          ${GREEN}${SERVER_IP}:27017${NC}"
echo -e "  API server:       ${GREEN}http://${SERVER_IP}:8000${NC}"
echo -e "  API health:       ${GREEN}http://${SERVER_IP}:8000/api/health${NC}"
echo -e "  API docs:         ${GREEN}http://${SERVER_IP}:8000/docs${NC}"
echo ""
echo -e "  ${YELLOW}Next steps:${NC}"
echo -e "  1. On each Windows PC, run (as Administrator):"
echo -e "     ${GREEN}deploy\\install_agent.bat ${SERVER_IP}${NC}"
echo -e "     or"
echo -e "     ${GREEN}deploy\\install_agent.ps1 -ServerIP ${SERVER_IP}${NC}"
echo ""
echo -e "  2. View logs:"
echo -e "     ${GREEN}docker compose logs -f${NC}"
echo ""
echo -e "  3. Stop services:"
echo -e "     ${GREEN}docker compose down${NC}"
echo ""
