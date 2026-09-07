import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database.session import SessionLocal
from app.models.user import User
from app.models.device import Device
from app.models.audit import AuditLog
from app.core.security import create_access_token

client = TestClient(app)

@pytest.fixture
def auth_headers():
    db = SessionLocal()
    user = db.query(User).filter(User.email == "janakiram12").first()
    db.close()
    token = create_access_token(user.id)
    return {"Authorization": f"Bearer {token}"}

def test_device_enrollment_and_defaults(auth_headers):
    response = client.post(
        "/api/v1/devices/enroll",
        headers=auth_headers,
        json={
            "device_name": "Test Privacy Handset",
            "device_model": "TestModel 5G",
            "android_version": "14.0",
            "app_version": "1.0.0"
        }
    )
    assert response.status_code == 201
    data = response.json()
    device_id = data["id"]
    
    assert data["camera_privacy_state"] == "ALLOWED"
    assert data["microphone_privacy_state"] == "ALLOWED"
    assert data["location_privacy_state"] == "ALLOWED"
    assert data["speaker_privacy_state"] == "ALLOWED"
    assert data["remote_controls_state"] == "ALLOWED"
    assert data["enrollment_status"] == "ENROLLED"

    db = SessionLocal()
    audit = db.query(AuditLog).filter(AuditLog.device_id == device_id, AuditLog.action == "DEVICE_ENROLLED").first()
    assert audit is not None
    db.close()

def test_camera_and_mic_privacy_rejections(auth_headers):
    reg_res = client.post(
        "/api/v1/devices/enroll",
        headers=auth_headers,
        json={"device_name": "Camera Guard Phone"}
    )
    dev_data = reg_res.json()
    device_id = dev_data["id"]
    device_token = dev_data["device_token"]

    # Pause Camera & Mic from Device
    pause_res = client.post(
        f"/api/v1/devices/{device_id}/privacy-state",
        headers={"X-Device-Token": device_token},
        json={
            "camera_privacy_state": "PAUSED_BY_DEVICE_USER",
            "microphone_privacy_state": "PAUSED_BY_DEVICE_USER"
        }
    )
    assert pause_res.status_code == 200

    # Test Camera Rejection
    cam_res = client.post(
        f"/api/v1/devices/{device_id}/commands",
        headers=auth_headers,
        json={"command_type": "START_CAMERA_STREAM", "payload": "{}"}
    )
    assert cam_res.status_code == 403
    assert "camera remote access is paused" in cam_res.json()["detail"].lower()

    # Test Mic Rejection
    mic_res = client.post(
        f"/api/v1/devices/{device_id}/commands",
        headers=auth_headers,
        json={"command_type": "START_VOICE_CALL", "payload": "{}"}
    )
    assert mic_res.status_code == 403
    assert "microphone remote access is paused" in mic_res.json()["detail"].lower()

    # Test Frame Push Rejection
    frame_res = client.post(
        f"/api/v1/devices/{device_id}/camera/frame",
        headers={"X-Device-Token": device_token},
        json={"image_data": "data:image/jpeg;base64,/9j/4AAQSkZJRg==", "facing": "FRONT"}
    )
    assert frame_res.status_code == 403

def test_location_and_speaker_privacy_rejections(auth_headers):
    reg_res = client.post(
        "/api/v1/devices/enroll",
        headers=auth_headers,
        json={"device_name": "Location Guard Phone"}
    )
    dev_data = reg_res.json()
    device_id = dev_data["id"]
    device_token = dev_data["device_token"]

    # Pause Location & Speaker
    pause_res = client.post(
        f"/api/v1/devices/{device_id}/privacy-state",
        headers={"X-Device-Token": device_token},
        json={
            "location_privacy_state": "PAUSED_BY_DEVICE_USER",
            "speaker_privacy_state": "PAUSED_BY_DEVICE_USER"
        }
    )
    assert pause_res.status_code == 200

    # Test Location Command Rejection
    loc_res = client.post(
        f"/api/v1/devices/{device_id}/commands",
        headers=auth_headers,
        json={"command_type": "LOCATE_NOW", "payload": "{}"}
    )
    assert loc_res.status_code == 403
    assert "location remote sharing is paused" in loc_res.json()["detail"].lower()

    # Test Speaker Command Rejection
    spk_res = client.post(
        f"/api/v1/devices/{device_id}/commands",
        headers=auth_headers,
        json={"command_type": "PLAY_ALARM", "payload": "{}"}
    )
    assert spk_res.status_code == 403
    assert "speaker and siren remote access is paused" in spk_res.json()["detail"].lower()

def test_device_revocation_lifecycle(auth_headers):
    reg_res = client.post(
        "/api/v1/devices/enroll",
        headers=auth_headers,
        json={"device_name": "Revocable Phone"}
    )
    dev_data = reg_res.json()
    device_id = dev_data["id"]

    revoke_res = client.post(
        f"/api/v1/devices/{device_id}/revoke",
        headers=auth_headers
    )
    assert revoke_res.status_code == 200
    assert revoke_res.json()["status"] == "revoked"

    db = SessionLocal()
    audit = db.query(AuditLog).filter(AuditLog.device_id == device_id, AuditLog.action == "DEVICE_REVOKED").first()
    assert audit is not None
    db.close()
