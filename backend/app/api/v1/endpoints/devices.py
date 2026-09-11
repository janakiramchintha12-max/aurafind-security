from datetime import datetime, timezone
from typing import List, Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status, Header
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.user import User
from app.models.device import Device
from app.schemas.device import (
    DeviceRegister,
    DeviceStatusUpdate,
    DeviceUpdate,
    DeviceResponse,
    DeviceChallengeResponse,
    DeviceEnrollmentRequest,
    DevicePrivacyStateUpdate
)
from app.api.v1.deps import get_current_user, verify_device_ownership, log_audit
from app.services.websocket_manager import manager

router = APIRouter()

@router.get("", response_model=List[DeviceResponse])
def list_devices(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    devices = db.query(Device).filter(Device.user_id == current_user.id).all()
    # Update online status dynamically based on heartbeat (> 2 mins ago considered offline)
    now = datetime.now(timezone.utc)
    for dev in devices:
        if dev.last_heartbeat:
            # Handle timezone awareness comparison
            hb = dev.last_heartbeat
            if hb.tzinfo is None:
                hb = hb.replace(tzinfo=timezone.utc)
            delta = (now - hb).total_seconds()
            if delta > 300 and dev.status == "ONLINE":
                dev.status = "OFFLINE"
    db.commit()
    return devices

@router.post("/register", response_model=DeviceResponse, status_code=status.HTTP_201_CREATED)
def register_device(
    device_in: DeviceRegister,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Register a new device for the authenticated user
    device = Device(
        user_id=current_user.id,
        device_name=device_in.device_name,
        device_model=device_in.device_model or "Unknown Model",
        android_version=device_in.android_version or "Unknown",
        app_version=device_in.app_version or "1.0.0",
        status="ONLINE",
        last_heartbeat=datetime.now(timezone.utc)
    )
    db.add(device)
    db.commit()
    db.refresh(device)

    log_audit(db, user_id=current_user.id, device_id=device.id, action="DEVICE_REGISTERED", resource=f"device:{device.id}")
    return device

@router.get("/{device_id}", response_model=DeviceResponse)
def get_device(
    device: Device = Depends(verify_device_ownership)
):
    return device

@router.patch("/{device_id}", response_model=DeviceResponse)
def update_device(
    device_in: DeviceUpdate,
    device: Device = Depends(verify_device_ownership),
    db: Session = Depends(get_db)
):
    if device_in.device_name is not None:
        device.device_name = device_in.device_name
    if device_in.device_model is not None:
        device.device_model = device_in.device_model
    if device_in.sim_number is not None:
        device.sim_number = device_in.sim_number
    if device_in.sim_status is not None:
        device.sim_status = device_in.sim_status
    if device_in.tracking_mode is not None:
        device.tracking_mode = device_in.tracking_mode
    if device_in.is_tracking_enabled is not None:
        device.is_tracking_enabled = device_in.is_tracking_enabled
    if device_in.is_lost_mode is not None:
        device.is_lost_mode = device_in.is_lost_mode
    if device_in.lost_mode_message is not None:
        device.lost_mode_message = device_in.lost_mode_message
    
    device.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(device)
    return device

@router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_device(
    device: Device = Depends(verify_device_ownership),
    db: Session = Depends(get_db)
):
    log_audit(db, user_id=device.user_id, device_id=device.id, action="DEVICE_REMOVED", resource=f"device:{device.id}")
    db.delete(device)
    db.commit()

@router.post("/{device_id}/status", response_model=DeviceResponse)
async def update_device_status(
    status_in: DeviceStatusUpdate,
    device_id: str,
    x_device_token: str = Header(..., alias="X-Device-Token"),
    db: Session = Depends(get_db)
):
    device = db.query(Device).filter(Device.id == device_id, Device.device_token == x_device_token).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid device credentials")

    if device.enrollment_status == "REVOKED":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Device enrollment has been revoked")

    ALLOWED_STATUS_FIELDS = {
        "battery_pct", "is_charging", "network_type", "wifi_status",
        "sim_status", "sim_number", "gps_status", "permission_status",
        "tracking_mode", "is_tracking_enabled", "is_lost_mode", "lost_mode_message",
        "camera_privacy_state", "microphone_privacy_state", "location_privacy_state",
        "speaker_privacy_state", "remote_controls_state"
    }

    for field, val in status_in.model_dump(exclude_unset=True).items():
        if field in ALLOWED_STATUS_FIELDS:
            setattr(device, field, val)

    device.last_heartbeat = datetime.now(timezone.utc)
    device.status = "ONLINE"
    db.commit()
    db.refresh(device)

    # Broadcast update to user dashboard websocket
    await manager.send_to_user(device.user_id, {
        "event": "DEVICE_STATUS_UPDATE",
        "device_id": device.id,
        "battery_pct": device.battery_pct,
        "is_charging": device.is_charging,
        "status": device.status,
        "network_type": device.network_type,
        "wifi_status": device.wifi_status,
        "gps_status": device.gps_status,
        "sim_status": device.sim_status,
        "tracking_mode": device.tracking_mode,
        "camera_privacy_state": device.camera_privacy_state,
        "microphone_privacy_state": device.microphone_privacy_state,
        "location_privacy_state": device.location_privacy_state,
        "speaker_privacy_state": device.speaker_privacy_state,
        "remote_controls_state": device.remote_controls_state
    })

    return device

@router.post("/enroll/challenge")
def get_enrollment_challenge(
    current_user: User = Depends(get_current_user)
):
    """
    Issue cryptographically secure 5-minute challenge nonce for APK Proof-of-Possession.
    """
    from app.core.crypto_proof import generate_enrollment_challenge
    return generate_enrollment_challenge(current_user.id)

@router.post("/enroll", response_model=DeviceResponse, status_code=status.HTTP_201_CREATED)
async def enroll_device(
    enroll_in: DeviceEnrollmentRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Mandatory APK-Based Device Enrollment Flow with Cryptographic Proof-of-Possession:
    Verifies signature over nonce against client's asymmetric public key.
    """
    from app.core.crypto_proof import verify_proof_of_possession

    # If cryptographic key is supplied, strictly verify proof-of-possession
    if enroll_in.device_public_key and (enroll_in.enrollment_nonce or enroll_in.proof_signature):
        valid = verify_proof_of_possession(
            user_id=current_user.id,
            device_name=enroll_in.device_name,
            nonce=enroll_in.enrollment_nonce or "",
            public_key_str=enroll_in.device_public_key,
            signature_str=enroll_in.proof_signature or ""
        )
        if not valid:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Cryptographic proof-of-possession verification failed: Invalid or expired challenge signature."
            )

    device = Device(
        user_id=current_user.id,
        device_name=enroll_in.device_name,
        device_model=enroll_in.device_model or "Android Handset",
        android_version=enroll_in.android_version or "14.0",
        app_version=enroll_in.app_version or "1.0.0",
        device_public_key=enroll_in.device_public_key,
        status="ONLINE",
        enrollment_status="ENROLLED",
        camera_privacy_state="ALLOWED",
        microphone_privacy_state="ALLOWED",
        location_privacy_state="ALLOWED",
        speaker_privacy_state="ALLOWED",
        remote_controls_state="ALLOWED",
        enrolled_at=datetime.now(timezone.utc),
        last_heartbeat=datetime.now(timezone.utc)
    )
    db.add(device)
    db.commit()
    db.refresh(device)

    log_audit(
        db,
        user_id=current_user.id,
        device_id=device.id,
        action="DEVICE_ENROLLED",
        resource=f"device:{device.id}",
        details=f"Device '{device.device_name}' successfully enrolled via APK cryptographic proof-of-possession."
    )
    return device

@router.post("/{device_id}/privacy-state", response_model=DeviceResponse)
async def update_device_privacy_state(
    privacy_in: DeviceStatusUpdate,
    device_id: str,
    x_device_token: str = Header(..., alias="X-Device-Token"),
    db: Session = Depends(get_db)
):
    """
    Authoritative Device-Controlled Privacy State Synchronization:
    Only the physical device user holding the valid X-Device-Token can toggle sensor privacy states.
    All state transitions generate immutable audit events.
    """
    device = db.query(Device).filter(Device.id == device_id, Device.device_token == x_device_token).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid device credentials")

    if device.enrollment_status == "REVOKED":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Device enrollment has been revoked")

    audit_details = []

    if privacy_in.camera_privacy_state is not None and privacy_in.camera_privacy_state != device.camera_privacy_state:
        old_val = device.camera_privacy_state
        device.camera_privacy_state = privacy_in.camera_privacy_state
        action = "CAMERA_PAUSED" if device.camera_privacy_state == "PAUSED_BY_DEVICE_USER" else "CAMERA_ENABLED"
        log_audit(db, user_id=device.user_id, device_id=device.id, action=action, resource=f"device:{device.id}:camera",
                  details=f"Camera remote access changed from {old_val} to {device.camera_privacy_state} by physical device user.")
        audit_details.append(f"Camera: {device.camera_privacy_state}")

    if privacy_in.microphone_privacy_state is not None and privacy_in.microphone_privacy_state != device.microphone_privacy_state:
        old_val = device.microphone_privacy_state
        device.microphone_privacy_state = privacy_in.microphone_privacy_state
        action = "MICROPHONE_PAUSED" if device.microphone_privacy_state == "PAUSED_BY_DEVICE_USER" else "MICROPHONE_ENABLED"
        log_audit(db, user_id=device.user_id, device_id=device.id, action=action, resource=f"device:{device.id}:mic",
                  details=f"Microphone remote access changed from {old_val} to {device.microphone_privacy_state} by physical device user.")
        audit_details.append(f"Microphone: {device.microphone_privacy_state}")

    if privacy_in.location_privacy_state is not None and privacy_in.location_privacy_state != device.location_privacy_state:
        old_val = device.location_privacy_state
        device.location_privacy_state = privacy_in.location_privacy_state
        action = "LOCATION_PAUSED" if device.location_privacy_state == "PAUSED_BY_DEVICE_USER" else "LOCATION_ENABLED"
        log_audit(db, user_id=device.user_id, device_id=device.id, action=action, resource=f"device:{device.id}:location",
                  details=f"Location remote sharing changed from {old_val} to {device.location_privacy_state} by physical device user.")
        audit_details.append(f"Location: {device.location_privacy_state}")

    if privacy_in.speaker_privacy_state is not None and privacy_in.speaker_privacy_state != device.speaker_privacy_state:
        old_val = device.speaker_privacy_state
        device.speaker_privacy_state = privacy_in.speaker_privacy_state
        action = "SPEAKER_PAUSED" if device.speaker_privacy_state == "PAUSED_BY_DEVICE_USER" else "SPEAKER_ENABLED"
        log_audit(db, user_id=device.user_id, device_id=device.id, action=action, resource=f"device:{device.id}:speaker",
                  details=f"Speaker/Siren access changed from {old_val} to {device.speaker_privacy_state} by physical device user.")
        audit_details.append(f"Speaker: {device.speaker_privacy_state}")

    if privacy_in.remote_controls_state is not None and privacy_in.remote_controls_state != device.remote_controls_state:
        device.remote_controls_state = privacy_in.remote_controls_state
        log_audit(db, user_id=device.user_id, device_id=device.id, action="CONTROLS_MODIFIED", resource=f"device:{device.id}:controls",
                  details=f"Remote controls state set to {device.remote_controls_state}")

    device.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(device)

    # Broadcast privacy update to user dashboard websocket
    await manager.send_to_user(device.user_id, {
        "event": "DEVICE_PRIVACY_STATE_UPDATE",
        "device_id": device.id,
        "camera_privacy_state": device.camera_privacy_state,
        "microphone_privacy_state": device.microphone_privacy_state,
        "location_privacy_state": device.location_privacy_state,
        "speaker_privacy_state": device.speaker_privacy_state,
        "remote_controls_state": device.remote_controls_state
    })

    return device

@router.post("/{device_id}/revoke", status_code=status.HTTP_200_OK)
def revoke_device(
    device: Device = Depends(verify_device_ownership),
    db: Session = Depends(get_db)
):
    device.enrollment_status = "REVOKED"
    device.status = "REVOKED"
    db.commit()
    log_audit(db, user_id=device.user_id, device_id=device.id, action="DEVICE_REVOKED", resource=f"device:{device.id}",
              details="Device credentials revoked by user.")
    return {"status": "revoked", "device_id": device.id}

@router.post("/{device_id}/heartbeat")
async def device_heartbeat(
    device_id: str,
    x_device_token: str = Header(..., alias="X-Device-Token"),
    db: Session = Depends(get_db)
):
    device = db.query(Device).filter(Device.id == device_id, Device.device_token == x_device_token).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid device credentials")

    if device.enrollment_status == "REVOKED":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Device enrollment has been revoked")
    
    device.last_heartbeat = datetime.now(timezone.utc)
    device.status = "ONLINE"
    db.commit()

    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}

class DeviceAutoPairRequest(BaseModel):
    username: str
    password: str
    device_name: Optional[str] = "Android Handset"
    device_model: Optional[str] = "Android Device"
    android_version: Optional[str] = "14.0"
    app_version: Optional[str] = "1.0.0"

@router.post("/auto-pair")
def auto_pair_device(
    payload: DeviceAutoPairRequest,
    db: Session = Depends(get_db)
):
    """
    Seamless Mobile-to-Cloud Auto-Pairing:
    Authenticates user and registers handset into their account, returning fresh device credentials.
    """
    from app.core.security import verify_password
    user = db.query(User).filter((User.email == payload.username) | (User.email == payload.username.lower())).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password for device auto-pairing"
        )

    device = Device(
        user_id=user.id,
        device_name=payload.device_name or "Android Handset",
        device_model=payload.device_model or "Android Device",
        android_version=payload.android_version or "14.0",
        app_version=payload.app_version or "1.0.0",
        status="ONLINE",
        enrollment_status="ENROLLED",
        last_heartbeat=datetime.now(timezone.utc)
    )
    db.add(device)
    db.commit()
    db.refresh(device)

    log_audit(db, user_id=user.id, device_id=device.id, action="DEVICE_AUTO_PAIRED", resource=f"device:{device.id}",
              details=f"Device '{device.device_name}' auto-paired with user '{user.email}'")

    return {
        "status": "success",
        "device_id": device.id,
        "device_token": device.device_token,
        "device_name": device.device_name,
        "device_model": device.device_model
    }

@router.post("/purge-all", status_code=status.HTTP_200_OK)
def purge_all_devices(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Permanently purge all enrolled devices and associated data for a complete fresh start.
    """
    from app.models.snapshot import Snapshot
    from app.models.location import Location
    from app.models.command import Command
    from app.models.geofence import Geofence
    from app.models.audit import AuditLog

    devices = db.query(Device).filter(Device.user_id == current_user.id).all()
    dev_ids = [d.id for d in devices]

    if dev_ids:
        db.query(Snapshot).filter(Snapshot.device_id.in_(dev_ids)).delete(synchronize_session=False)
        db.query(Location).filter(Location.device_id.in_(dev_ids)).delete(synchronize_session=False)
        db.query(Command).filter(Command.device_id.in_(dev_ids)).delete(synchronize_session=False)
        db.query(Device).filter(Device.id.in_(dev_ids)).delete(synchronize_session=False)

    db.query(Geofence).filter(Geofence.user_id == current_user.id).delete(synchronize_session=False)
    db.query(AuditLog).filter(AuditLog.user_id == current_user.id).delete(synchronize_session=False)
    db.commit()

    return {"status": "purged", "message": "All devices and historical records have been permanently cleared."}
