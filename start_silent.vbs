Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "c:\Users\janak\Desktop\theft.in"
WshShell.Run "cmd /c set PYTHONPATH=. && python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000", 0, False
WshShell.Run "cmd /c .\cloudflared.exe tunnel --url http://127.0.0.1:8000", 0, False
