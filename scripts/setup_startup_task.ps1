# AuraFind Windows Self-Healing Auto-Startup Setup (Shortcut + Task)
$StartupFolder = [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs\Startup")
$VbsPath = Join-Path $StartupFolder "AuraFindSelfHealingDaemon.vbs"
$ScriptPath = "c:\Users\janak\Desktop\theft.in\backend\scripts\watchdog.py"

Write-Host "Configuring AuraFind Windows Zero-Touch Startup Engine..." -ForegroundColor Cyan

# VBScript launcher to run Python Watchdog silently in background on Windows Boot
$VbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "python `"$ScriptPath`"", 0, False
"@

Set-Content -Path $VbsPath -Value $VbsContent -Force
Write-Host "SUCCESS: Windows Startup Launcher created at: $VbsPath" -ForegroundColor Green
Write-Host "AuraFind Watchdog will now automatically boot on PC restart!" -ForegroundColor Green
