@echo off
echo ===================================================
echo   AuraFind / Theft.in - Android App Auto Updater
echo ===================================================
echo Checking for connected Android devices...
adb wait-for-device
echo Device detected! Installing latest build with Rear Camera Fix & 3-Hour Recording...
adb install -r "%~dp0android\app\build\outputs\apk\debug\app-debug.apk"
if %errorlevel% neq 0 (
    echo Installation failed! Retrying with uninstall...
    adb install -r -d "%~dp0android\app\build\outputs\apk\debug\app-debug.apk"
)
echo Granting camera, microphone, and location permissions...
adb shell pm grant com.findmydevice.security android.permission.ACCESS_FINE_LOCATION
adb shell pm grant com.findmydevice.security android.permission.ACCESS_COARSE_LOCATION
adb shell pm grant com.findmydevice.security android.permission.ACCESS_BACKGROUND_LOCATION
adb shell pm grant com.findmydevice.security android.permission.CAMERA
adb shell pm grant com.findmydevice.security android.permission.RECORD_AUDIO
adb shell pm grant com.findmydevice.security android.permission.POST_NOTIFICATIONS
adb shell pm grant com.findmydevice.security android.permission.READ_PHONE_STATE
adb shell appops set com.findmydevice.security SYSTEM_ALERT_WINDOW allow
echo Starting updated service...
adb shell am start -n com.findmydevice.security/.MainActivity
echo ===================================================
echo   Successfully Updated AuraFind on your Phone!
echo ===================================================
pause
