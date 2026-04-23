@echo off
REM ──────────────────────────────────────────────────────────────────────
REM NetPulse Agent Installer (Batch Wrapper)
REM
REM USAGE (run as Administrator):
REM   install_agent.bat 192.168.1.100
REM   install_agent.bat 192.168.1.100 MY-PC-NAME
REM ──────────────────────────────────────────────────────────────────────

echo.
echo ══════════════════════════════════════════
echo    NetPulse Agent Installer
echo ══════════════════════════════════════════
echo.

if "%1"=="" (
    echo ERROR: Server IP address is required!
    echo.
    echo USAGE: install_agent.bat ^<SERVER_IP^> [PC_NAME]
    echo.
    echo Examples:
    echo   install_agent.bat 192.168.1.100
    echo   install_agent.bat 192.168.1.100 LAB-PC-01
    echo.
    pause
    exit /b 1
)

set SERVER_IP=%1

if not "%2"=="" (
    set PC_NAME=%2
) else (
    set PC_NAME=%COMPUTERNAME%
)

echo   Server IP:  %SERVER_IP%
echo   PC Name:    %PC_NAME%
echo.

REM Check for PowerShell
powershell -Command "exit 0" >nul 2>&1
if errorlevel 1 (
    echo ERROR: PowerShell is not available.
    pause
    exit /b 1
)

REM Run the PowerShell installer
powershell -ExecutionPolicy Bypass -File "%~dp0install_agent.ps1" -ServerIP "%SERVER_IP%" -PCName "%PC_NAME%"

pause
