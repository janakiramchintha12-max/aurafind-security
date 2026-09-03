from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, Header
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.user import User
from app.models.device import Device
from app.schemas.device import DeviceRegister, DeviceStatusUpdate, DeviceUpdate, DeviceResponse
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
    if device_in.tracking_mode is not None:
        device.tracking_mode = device_in.tracking_mode
    if device_in.is_tracking_enabled is not None:
        device.is_tracking_enabled = device_in.is_tracking_enabled
    
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

    for field, val in status_in.model_dump(exclude_unset=True).items():
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
        "tracking_mode": device.tracking_mode
    })

    return device

@router.post("/{device_id}/heartbeat")
async def device_heartbeat(
    device_id: str,
    x_device_token: str = Header(..., alias="X-Device-Token"),
    db: Session = Depends(get_db)
):
    device = db.query(Device).filter(Device.id == device_id, Device.device_token == x_device_token).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid device credentials")
    
    device.last_heartbeat = datetime.now(timezone.utc)
    device.status = "ONLINE"
    db.commit()

    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}
