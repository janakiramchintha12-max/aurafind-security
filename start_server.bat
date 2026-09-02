@echo off
title AuraFind Security Server Daemon
cd /d "c:\Users\janak\Desktop\theft.in"

echo ====================================================
echo  Starting AuraFind Security Unified Server...
echo ====================================================

set PYTHONPATH=.
start "" /B python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
start "" /B .\cloudflared.exe tunnel --url http://127.0.0.1:8000

timeout /t 3 /nobreak >nul
start http://localhost:8000
