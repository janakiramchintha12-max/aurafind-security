@echo off
title AuraFind Security Server Daemon
cd /d "c:\Users\janak\Desktop\theft.in"

echo ====================================================
echo  Starting AuraFind Security Unified Server...
echo ====================================================

set PYTHONPATH=.;backend
start "" /B python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000
start "" /B .\cloudflared.exe tunnel --url http://127.0.0.1:8000

ping 127.0.0.1 -n 4 >nul
start http://localhost:8000
