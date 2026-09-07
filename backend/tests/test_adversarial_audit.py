import pytest
import base64
import time
from datetime import datetime, timezone, timedelta
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from fastapi.testclient import TestClient

def get_auth_header(client: TestClient, email: str = "redteam_user@test.com", password: str = "RedTeamPass123!"):
    # Register or login
    client.post("/api/v1/auth/register", json={"email": email, "password": password, "full_name": "Red Team Tester"})
    res = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

# ==============================================================================
# 1. CAMERA PRIVACY BYPASS TESTS
# ==============================================================================
def test_camera_privacy_adversarial_bypass(client: TestClient):
    auth = get_auth_header(client, "cam_user@test.com")
    
    # 1. Enroll device
    enroll_res = client.post("/api/v1/devices/enroll", json={"device_name": "Camera Target Phone"}, headers=auth)
    assert enroll_res.status_code == 201
    dev = enroll_res.json()
    dev_id, dev_token = dev["id"], dev["device_token"]
    dev_header = {"X-Device-Token": dev_token}

    # 2. Device pauses camera
    client.post(f"/api/v1/devices/{dev_id}/privacy-state", json={"camera_privacy_state": "PAUSED_BY_DEVICE_USER"}, headers=dev_header)

    # Attack 1: Dispatch START_CAMERA_STREAM
    res1 = client.post(f"/api/v1/devices/{dev_id}/commands", json={"command_type": "START_CAMERA_STREAM"}, headers=auth)
    assert res1.status_code == 403
    assert "Camera remote access is paused" in res1.json()["detail"]

    # Attack 2: Dispatch CAPTURE_SNAPSHOT
    res2 = client.post(f"/api/v1/devices/{dev_id}/commands", json={"command_type": "CAPTURE_SNAPSHOT"}, headers=auth)
    assert res2.status_code == 403

    # Attack 3: Direct camera frame push
    res3 = client.post(f"/api/v1/devices/{dev_id}/camera/frame", json={"image_data": "data:image/jpeg;base64,1234"}, headers=dev_header)
    assert res3.status_code == 403

    # Attack 4: Non-intruder snapshot upload
    res4 = client.post(f"/api/v1/devices/{dev_id}/snapshots", json={"image_data": "data:image/jpeg;base64,1234", "is_intruder_alert": False}, headers=dev_header)
    assert res4.status_code == 403

    # Attack 5: Direct get latest camera frame
    res5 = client.get(f"/api/v1/devices/{dev_id}/camera/latest", headers=auth)
    assert res5.status_code == 200
    assert res5.json()["has_frame"] is False
    assert res5.json()["privacy_state"] == "PAUSED_BY_DEVICE_USER"

# ==============================================================================
# 2. MICROPHONE PRIVACY BYPASS TESTS
# ==============================================================================
def test_microphone_privacy_adversarial_bypass(client: TestClient):
    auth = get_auth_header(client, "mic_user@test.com")
    
    enroll_res = client.post("/api/v1/devices/enroll", json={"device_name": "Mic Target Phone"}, headers=auth)
    dev = enroll_res.json()
    dev_id, dev_token = dev["id"], dev["device_token"]
    dev_header = {"X-Device-Token": dev_token}

    # Device pauses microphone
    client.post(f"/api/v1/devices/{dev_id}/privacy-state", json={"microphone_privacy_state": "PAUSED_BY_DEVICE_USER"}, headers=dev_header)

    # Attack 1: Dispatch START_VOICE_CALL
    res1 = client.post(f"/api/v1/devices/{dev_id}/commands", json={"command_type": "START_VOICE_CALL"}, headers=auth)
    assert res1.status_code == 403
    assert "Microphone remote access is paused" in res1.json()["detail"]

    # Attack 2: Push audio chunk
    res2 = client.post(f"/api/v1/devices/{dev_id}/audio/chunk", json={"audio_data": "base64audio", "direction": "DEVICE_TO_DASHBOARD"}, headers=dev_header)
    assert res2.status_code == 403

    # Attack 3: Poll dashboard audio
    res3 = client.get(f"/api/v1/devices/{dev_id}/audio/dashboard_poll", headers=auth)
    assert res3.status_code == 200
    assert res3.json() == []

# ==============================================================================
# 3. GPS LOCATION PRIVACY BYPASS TESTS
# ==============================================================================
def test_gps_location_privacy_adversarial_bypass(client: TestClient):
    auth = get_auth_header(client, "gps_user@test.com")
    
    enroll_res = client.post("/api/v1/devices/enroll", json={"device_name": "GPS Target Phone"}, headers=auth)
    dev = enroll_res.json()
    dev_id, dev_token = dev["id"], dev["device_token"]
    dev_header = {"X-Device-Token": dev_token}

    # 1. Post initial location when allowed
    init_loc = client.post(f"/api/v1/devices/{dev_id}/locations", json={
        "latitude": 12.9716, "longitude": 77.5946, "accuracy": 10.0,
        "client_timestamp": datetime.now(timezone.utc).isoformat()
    }, headers=dev_header)
    assert init_loc.status_code == 201

    # 2. Device pauses location telemetry
    client.post(f"/api/v1/devices/{dev_id}/privacy-state", json={"location_privacy_state": "PAUSED_BY_DEVICE_USER"}, headers=dev_header)

    # Attack 1: Dispatch LOCATE_NOW
    res1 = client.post(f"/api/v1/devices/{dev_id}/commands", json={"command_type": "LOCATE_NOW"}, headers=auth)
    assert res1.status_code == 403

    # Attack 2: Single location upload
    res2 = client.post(f"/api/v1/devices/{dev_id}/locations", json={
        "latitude": 13.0000, "longitude": 77.6000, "accuracy": 5.0,
        "client_timestamp": datetime.now(timezone.utc).isoformat()
    }, headers=dev_header)
    assert res2.status_code == 403

    # Attack 3: Batch location sync
    res3 = client.post(f"/api/v1/devices/{dev_id}/locations/batch", json={
        "locations": [{
            "latitude": 13.0000, "longitude": 77.6000, "accuracy": 5.0,
            "client_timestamp": datetime.now(timezone.utc).isoformat()
        }]
    }, headers=dev_header)
    assert res3.status_code == 403

    # Verify historical data is retained without deletion
    hist_res = client.get(f"/api/v1/devices/{dev_id}/locations?range=today", headers=auth)
    assert hist_res.status_code == 200
    assert len(hist_res.json()) >= 1

# ==============================================================================
# 4. SPEAKER & SIREN PRIVACY BYPASS TESTS
# ==============================================================================
def test_speaker_siren_privacy_adversarial_bypass(client: TestClient):
    auth = get_auth_header(client, "speaker_user@test.com")
    
    enroll_res = client.post("/api/v1/devices/enroll", json={"device_name": "Speaker Target Phone"}, headers=auth)
    dev = enroll_res.json()
    dev_id, dev_token = dev["id"], dev["device_token"]
    dev_header = {"X-Device-Token": dev_token}

    # Device pauses loudspeaker & siren
    client.post(f"/api/v1/devices/{dev_id}/privacy-state", json={"speaker_privacy_state": "PAUSED_BY_DEVICE_USER"}, headers=dev_header)

    # Attack 1: Dispatch PLAY_ALARM
    res1 = client.post(f"/api/v1/devices/{dev_id}/commands", json={"command_type": "PLAY_ALARM"}, headers=auth)
    assert res1.status_code == 403

    # Attack 2: Dispatch SPEAK_TEXT
    res2 = client.post(f"/api/v1/devices/{dev_id}/commands", json={"command_type": "SPEAK_TEXT", "payload": '{"text":"Emergency"}'}, headers=auth)
    assert res2.status_code == 403

    # Attack 3: Send dashboard audio to device
    res3 = client.post(f"/api/v1/devices/{dev_id}/audio/dashboard_send", json={"audio_data": "base64audio", "direction": "DASHBOARD_TO_DEVICE"}, headers=auth)
    assert res3.status_code == 403

    # Attack 4: Poll incoming audio for device
    res4 = client.get(f"/api/v1/devices/{dev_id}/audio/incoming", headers=dev_header)
    assert res4.status_code == 200
    assert res4.json() == []

# ==============================================================================
# 5. CRYPTOGRAPHIC PROOF-OF-POSSESSION ENROLLMENT TESTS
# ==============================================================================
def test_cryptographic_proof_of_possession_enrollment(client: TestClient):
    auth = get_auth_header(client, "crypto_user@test.com")
    
    # 1. Request enrollment challenge nonce
    chal_res = client.post("/api/v1/devices/enroll/challenge", headers=auth)
    assert chal_res.status_code == 200
    chal = chal_res.json()
    nonce = chal["nonce"]
    user_id = chal["user_id"]

    # 2. Client generates ECDSA P-256 Keypair
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()
    pub_pem = public_key.public_bytes(
        encoding=Encoding.PEM,
        format=PublicFormat.SubjectPublicKeyInfo
    ).decode("utf-8")

    device_name = "Secured Crypto Handset"
    payload_to_sign = f"{user_id}:{device_name}:{nonce}".encode("utf-8")
    signature = private_key.sign(payload_to_sign, ec.ECDSA(hashes.SHA256()))
    sig_b64 = base64.b64encode(signature).decode("utf-8")

    # 3. Legitimate enrollment with valid proof of possession
    enroll_res = client.post("/api/v1/devices/enroll", json={
        "device_name": device_name,
        "device_model": "Pixel 9 Pro Cryptographic Edition",
        "device_public_key": pub_pem,
        "enrollment_nonce": nonce,
        "proof_signature": sig_b64
    }, headers=auth)
    assert enroll_res.status_code == 201
    dev = enroll_res.json()
    assert dev["enrollment_status"] == "ENROLLED"

    # Attack 1: Nonce Replay Attack (attempt to reuse same nonce)
    replay_res = client.post("/api/v1/devices/enroll", json={
        "device_name": device_name,
        "device_public_key": pub_pem,
        "enrollment_nonce": nonce,
        "proof_signature": sig_b64
    }, headers=auth)
    assert replay_res.status_code == 401
    assert "proof-of-possession verification failed" in replay_res.json()["detail"]

    # Attack 2: Forged Signature (sign with different private key)
    chal_res2 = client.post("/api/v1/devices/enroll/challenge", headers=auth)
    nonce2 = chal_res2.json()["nonce"]
    attacker_key = ec.generate_private_key(ec.SECP256R1())
    bad_signature = attacker_key.sign(f"{user_id}:{device_name}:{nonce2}".encode("utf-8"), ec.ECDSA(hashes.SHA256()))
    bad_sig_b64 = base64.b64encode(bad_signature).decode("utf-8")

    forged_res = client.post("/api/v1/devices/enroll", json={
        "device_name": device_name,
        "device_public_key": pub_pem,  # Target pubkey
        "enrollment_nonce": nonce2,
        "proof_signature": bad_sig_b64   # Forged signature
    }, headers=auth)
    assert forged_res.status_code == 401

# ==============================================================================
# 6. DEVICE ID / IDOR SECURITY AUDIT
# ==============================================================================
def test_idor_cross_account_isolation(client: TestClient):
    auth_a = get_auth_header(client, "victim_a@test.com")
    auth_b = get_auth_header(client, "attacker_b@test.com")

    # User A enrolls Device A
    dev_a = client.post("/api/v1/devices/enroll", json={"device_name": "Victim Device A"}, headers=auth_a).json()
    dev_a_id = dev_a["id"]

    # Attacker B attempts IDOR across all endpoints
    res_get = client.get(f"/api/v1/devices/{dev_a_id}", headers=auth_b)
    assert res_get.status_code == 403

    res_cmd = client.post(f"/api/v1/devices/{dev_a_id}/commands", json={"command_type": "LOCATE_NOW"}, headers=auth_b)
    assert res_cmd.status_code == 403

    res_snap = client.get(f"/api/v1/devices/{dev_a_id}/snapshots", headers=auth_b)
    assert res_snap.status_code == 403

    res_loc = client.get(f"/api/v1/devices/{dev_a_id}/locations", headers=auth_b)
    assert res_loc.status_code == 403

    res_cam = client.get(f"/api/v1/devices/{dev_a_id}/camera/latest", headers=auth_b)
    assert res_cam.status_code == 403

    res_revoke = client.post(f"/api/v1/devices/{dev_a_id}/revoke", headers=auth_b)
    assert res_revoke.status_code == 403

# ==============================================================================
# 7. DEVICE REVOCATION LIFECYCLE
# ==============================================================================
def test_device_revocation_lockdown(client: TestClient):
    auth = get_auth_header(client, "revoke_test@test.com")
    dev = client.post("/api/v1/devices/enroll", json={"device_name": "Revoke Target Phone"}, headers=auth).json()
    dev_id, dev_token = dev["id"], dev["device_token"]
    dev_header = {"X-Device-Token": dev_token}

    # Revoke device
    rev_res = client.post(f"/api/v1/devices/{dev_id}/revoke", headers=auth)
    assert rev_res.status_code == 200
    assert rev_res.json()["status"] == "revoked"

    # All device-authenticated endpoints must reject revoked token with 403
    assert client.post(f"/api/v1/devices/{dev_id}/status", json={"battery_pct": 50.0}, headers=dev_header).status_code == 403
    assert client.post(f"/api/v1/devices/{dev_id}/heartbeat", headers=dev_header).status_code == 403
    assert client.post(f"/api/v1/devices/{dev_id}/privacy-state", json={"camera_privacy_state": "ALLOWED"}, headers=dev_header).status_code == 403
    assert client.post(f"/api/v1/devices/{dev_id}/locations", json={"latitude": 0, "longitude": 0, "accuracy": 1, "client_timestamp": datetime.now(timezone.utc).isoformat()}, headers=dev_header).status_code == 403
    assert client.post(f"/api/v1/devices/{dev_id}/camera/frame", json={"image_data": "frame"}, headers=dev_header).status_code == 403
    assert client.post(f"/api/v1/devices/{dev_id}/audio/chunk", json={"audio_data": "chunk"}, headers=dev_header).status_code == 403
    assert client.get(f"/api/v1/devices/{dev_id}/commands/pending", headers=dev_header).status_code == 403

# ==============================================================================
# 8. STALE COMMAND CONCURRENCY & RACE-CONDITION PREVENTION
# ==============================================================================
def test_stale_command_race_condition_auto_rejection(client: TestClient):
    auth = get_auth_header(client, "race_user@test.com")
    dev = client.post("/api/v1/devices/enroll", json={"device_name": "Race Test Phone"}, headers=auth).json()
    dev_id, dev_token = dev["id"], dev["device_token"]
    dev_header = {"X-Device-Token": dev_token}

    # 1. Admin dispatches camera command while camera was ALLOWED
    cmd_res = client.post(f"/api/v1/devices/{dev_id}/commands", json={"command_type": "START_CAMERA_STREAM"}, headers=auth)
    assert cmd_res.status_code == 201

    # 2. Concurrently, device user toggles Camera to PAUSED before polling command
    client.post(f"/api/v1/devices/{dev_id}/privacy-state", json={"camera_privacy_state": "PAUSED_BY_DEVICE_USER"}, headers=dev_header)

    # 3. Device polls for pending commands
    pending_res = client.get(f"/api/v1/devices/{dev_id}/commands/pending", headers=dev_header)
    assert pending_res.status_code == 200
    # The stale camera command MUST be auto-rejected and NOT returned to the device!
    assert len(pending_res.json()) == 0

    # 4. Verify command was marked FAILED / REJECTED in database
    cmds_res = client.get(f"/api/v1/devices/{dev_id}/commands", headers=auth)
    assert cmds_res.status_code == 200
    latest_cmd = cmds_res.json()[0]
    assert latest_cmd["status"] == "FAILED"
    assert "Sensor access was paused" in latest_cmd["result"]
