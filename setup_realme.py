import subprocess
import os

dev_serial = 'f81cf1ce'
dev_id = 'aaf11e59-f8a6-4762-80e5-f4a5f4ea21f5'
dev_token = '5e94b97f-4fd0-4b47-a2eb-cc3ea098179b'
adb = r'C:\Users\janak\AppData\Local\Android\Sdk\platform-tools\adb.exe'

# 1. Inject SharedPreferences
xml_content = f"""<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <boolean name="is_lost_mode" value="false" />
    <string name="device_id">{dev_id}</string>
    <string name="device_token">{dev_token}</string>
</map>"""

with open('temp_prefs.xml', 'w', encoding='utf-8') as f:
    f.write(xml_content)

subprocess.run([adb, '-s', dev_serial, 'push', 'temp_prefs.xml', '/data/local/tmp/aurafind_prefs.xml'])
subprocess.run([adb, '-s', dev_serial, 'shell', 'run-as', 'com.findmydevice.security', 'mkdir', '-p', '/data/data/com.findmydevice.security/shared_prefs'])
subprocess.run([adb, '-s', dev_serial, 'shell', 'run-as', 'com.findmydevice.security', 'cp', '/data/local/tmp/aurafind_prefs.xml', '/data/data/com.findmydevice.security/shared_prefs/aurafind_prefs.xml'])
subprocess.run([adb, '-s', dev_serial, 'shell', 'run-as', 'com.findmydevice.security', 'chmod', '660', '/data/data/com.findmydevice.security/shared_prefs/aurafind_prefs.xml'])
if os.path.exists('temp_prefs.xml'):
    os.remove('temp_prefs.xml')

# 2. Grant all runtime permissions
perms = [
    'android.permission.CAMERA',
    'android.permission.RECORD_AUDIO',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.ACCESS_BACKGROUND_LOCATION',
    'android.permission.READ_PHONE_STATE',
    'android.permission.READ_PHONE_NUMBERS',
    'android.permission.READ_CALL_LOG',
    'android.permission.READ_CONTACTS',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.RECEIVE_SMS',
    'android.permission.SEND_SMS',
    'android.permission.READ_SMS',
    'android.permission.BODY_SENSORS',
    'android.permission.ACTIVITY_RECOGNITION'
]
for p in perms:
    subprocess.run([adb, '-s', dev_serial, 'shell', 'pm', 'grant', 'com.findmydevice.security', p])

# 3. Grant AppOps
subprocess.run([adb, '-s', dev_serial, 'shell', 'appops', 'set', 'com.findmydevice.security', 'SYSTEM_ALERT_WINDOW', 'allow'])
subprocess.run([adb, '-s', dev_serial, 'shell', 'appops', 'set', 'com.findmydevice.security', 'GET_USAGE_STATS', 'allow'])
subprocess.run([adb, '-s', dev_serial, 'shell', 'appops', 'set', 'com.findmydevice.security', 'PROJECT_MEDIA', 'allow'])

# 4. Battery optimization & Admin
subprocess.run([adb, '-s', dev_serial, 'shell', 'dumpsys', 'deviceidle', 'whitelist', '+com.findmydevice.security'])
subprocess.run([adb, '-s', dev_serial, 'shell', 'dpm', 'set-active-admin', 'com.findmydevice.security/.service.AuraFindDeviceAdminReceiver'])

# 5. Launch app & service
subprocess.run([adb, '-s', dev_serial, 'shell', 'am', 'start', '-n', 'com.findmydevice.security/.MainActivity'])

print('All configuration and setup finished cleanly for Realme P3 5G!')
