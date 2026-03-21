@echo off
REM ──────────────────────────────────────────────────────────────────────
REM NetPulse Agent Startup Script (Windows)
REM
REM USAGE:
REM   start_agent.bat                    → connects to Kafka on localhost:9092
REM   start_agent.bat 192.168.1.100      → connects to Kafka on 192.168.1.100:9092
REM   start_agent.bat 192.168.1.100 PC01 → custom PC name
REM ──────────────────────────────────────────────────────────────────────

echo ═══════════════════════════════════════
echo    NetPulse Agent Startup
echo ═══════════════════════════════════════
echo.

REM ─── Parse arguments ────────────────────────────────────────────────
if "%1"=="" (
    set KAFKA_BROKER=localhost:9092
) else (
    set KAFKA_BROKER=%1:9092
)

if not "%2"=="" (
    set PC_ID=%2
)

set KAFKA_TOPIC=network-logs
set COLLECT_INTERVAL=60

echo   Kafka Broker:  %KAFKA_BROKER%
echo   PC ID:         %PC_ID%
echo   Topic:         %KAFKA_TOPIC%
echo   Interval:      %COLLECT_INTERVAL%s
echo.

REM ─── Check Python is available ──────────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or not in PATH.
    pause
    exit /b 1
)

REM ─── Install dependencies if needed ─────────────────────────────────
echo [1/2] Checking dependencies...
pip show psutil >nul 2>&1 || pip install psutil
pip show kafka-python >nul 2>&1 || pip install kafka-python
echo   Done.
echo.

REM ─── Start the agent ────────────────────────────────────────────────
echo [2/2] Starting agent...
echo.
cd /d "%~dp0"
python network_log_agent.py
