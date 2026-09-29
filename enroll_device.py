import urllib.request
import json
import subprocess
import os
import time

dev_serial = 'ZA222RFJB7'
adb = r'C:\Users\janak\AppData\Local\Android\Sdk\platform-tools\adb.exe'

# 1. Login to cloud backend
print('Step 1: Logging in to Render backend...')
url = 'https://aurafind-security.onrender.com/api/v1/auth/login'
data = json.dumps({'email': 'founder@theft.in', 'password': 'SecureFounder2026!'}).encode()
req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
res = urllib.request.urlopen(req)
token = json.loads(res.read())['access_token']
print('Login successful!')

# 2. Get or Register device
print('Step 2: Checking existing devices on cloud...')
list_req = urllib.request.Request('https://aurafind-security.onrender.com/api/v1/devices', headers={'Authorization': 'Bearer ' + token})
list_res = urllib.request.urlopen(list_req)
devices = json.loads(list_res.read())

if devices:
    PERM_ID = '67bfe7a4-2b79-4bde-958a-2dd15529ee30'
    dev = next((d for d in devices if d.get('id') == PERM_ID), devices[0])
    dev_id = dev['id']
    dev_token = dev.get('device_token') or 'd08a8f7f-ec74-4055-90d0-8a4d302e066f'
    print(f'Using existing registered device: ID={dev_id}, Name={dev.get("device_name")}')
else:
    print('No device on cloud. Registering new device...')
    reg_url = 'https://aurafind-security.onrender.com/api/v1/devices/register'
    reg_payload = {
        'device_name': 'Motorola Edge 50 Fusion',
        'device_model': 'motorola edge 50 fusion',
        'android_version': '16',
        'app_version': '1.0.0'
    }
    reg_req = urllib.request.Request(reg_url, data=json.dumps(reg_payload).encode(), headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    reg_res = urllib.request.urlopen(reg_req)
    reg_data = json.loads(reg_res.read())
    dev_id = reg_data['id']
    dev_token = reg_data['device_token']
    print(f'Device registered! ID: {dev_id}, Token: {dev_token}')

# 3. Install latest debug APK
print('Step 3: Installing app-debug.apk...')
apk_path = r'c:\Users\janak\Desktop\theft.in\android\app\build\outputs\apk\debug\app-debug.apk'
inst_res = subprocess.run([adb, '-s', dev_serial, 'install', '-r', apk_path], capture_output=True, text=True)
print('Install output:', inst_res.stdout.strip() or inst_res.stderr.strip())

# 4. Inject SharedPreferences
print('Step 4: Injecting credentials into SharedPreferences...')
xml_content = '<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\n' \
              '<map>\n' \
              '    <boolean name="is_lost_mode" value="false" />\n' \
              f'    <string name="device_id">{dev_id}</string>\n' \
              f'    <string name="device_token">{dev_token}</string>\n' \
              '</map>'

with open('temp_prefs.xml', 'w', encoding='utf-8') as f:
    f.write(xml_content)

subprocess.run([adb, '-s', dev_serial, 'push', 'temp_prefs.xml', '/data/local/tmp/aurafind_prefs.xml'], check=True)
subprocess.run([adb, '-s', dev_serial, 'shell', 'run-as', 'com.findmydevice.security', 'mkdir', '-p', '/data/data/com.findmydevice.security/shared_prefs'], check=True)
subprocess.run([adb, '-s', dev_serial, 'shell', 'run-as', 'com.findmydevice.security', 'cp', '/data/local/tmp/aurafind_prefs.xml', '/data/data/com.findmydevice.security/shared_prefs/aurafind_prefs.xml'], check=True)
subprocess.run([adb, '-s', dev_serial, 'shell', 'run-as', 'com.findmydevice.security', 'chmod', '660', '/data/data/com.findmydevice.security/shared_prefs/aurafind_prefs.xml'], check=True)
if os.path.exists('temp_prefs.xml'):
    os.remove('temp_prefs.xml')
print('Credentials injected successfully!')

# 5. Grant all runtime permissions
print('Step 5: Granting permissions...')
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
    subprocess.run([adb, '-s', dev_serial, 'shell', 'pm', 'grant', 'com.findmydevice.security', p], stderr=subprocess.DEVNULL)

# AppOps
subprocess.run([adb, '-s', dev_serial, 'shell', 'appops', 'set', 'com.findmydevice.security', 'SYSTEM_ALERT_WINDOW', 'allow'])
subprocess.run([adb, '-s', dev_serial, 'shell', 'appops', 'set', 'com.findmydevice.security', 'GET_USAGE_STATS', 'allow'])
subprocess.run([adb, '-s', dev_serial, 'shell', 'appops', 'set', 'com.findmydevice.security', 'PROJECT_MEDIA', 'allow'])

# Battery optimization & Device Admin
subprocess.run([adb, '-s', dev_serial, 'shell', 'dumpsys', 'deviceidle', 'whitelist', '+com.findmydevice.security'])
subprocess.run([adb, '-s', dev_serial, 'shell', 'dpm', 'set-active-admin', 'com.findmydevice.security/.service.AuraFindDeviceAdminReceiver'])

# 6. Launch App
print('Step 6: Launching AuraFind Security...')
subprocess.run([adb, '-s', dev_serial, 'shell', 'am', 'force-stop', 'com.findmydevice.security'])
subprocess.run([adb, '-s', dev_serial, 'shell', 'am', 'start', '-n', 'com.findmydevice.security/.MainActivity'])

print('Waiting 6s for telemetry & heartbeat sync...')
time.sleep(6)

# 7. Check backend device status
check_req = urllib.request.Request('https://aurafind-security.onrender.com/api/v1/devices/' + dev_id, headers={'Authorization': 'Bearer ' + token})
check_res = urllib.request.urlopen(check_req)
status_data = json.loads(check_res.read())
print('Device Status on Dashboard:')
print('  Name:', status_data['device_name'])
print('  Status:', status_data['status'])
print('  Battery:', status_data.get('battery_pct'))
print('  GPS:', status_data.get('last_latitude'), status_data.get('last_longitude'))
print('  Last Heartbeat:', status_data.get('last_heartbeat'))
