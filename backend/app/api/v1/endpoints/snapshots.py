from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, Header
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.device import Device
from app.models.snapshot import Snapshot
from app.schemas.snapshot import SnapshotCreate, SnapshotResponse
from app.api.v1.deps import get_current_user, verify_device_ownership, log_audit
from app.services.websocket_manager import manager

router = APIRouter()

@router.post("/{device_id}/snapshots", response_model=SnapshotResponse, status_code=status.HTTP_201_CREATED)
async def create_snapshot(
    snapshot_in: SnapshotCreate,
    device_id: str,
    x_device_token: str = Header(..., alias="X-Device-Token"),
    db: Session = Depends(get_db)
):
    device = db.query(Device).filter(Device.id == device_id, Device.device_token == x_device_token).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid device credentials")

    snap = Snapshot(
        device_id=device_id,
        image_data=snapshot_in.image_data,
        latitude=snapshot_in.latitude or device.last_latitude,
        longitude=snapshot_in.longitude or device.last_longitude,
        is_intruder_alert=snapshot_in.is_intruder_alert,
        timestamp=datetime.now(timezone.utc)
    )
    db.add(snap)
    db.commit()
    db.refresh(snap)

    if snap.is_intruder_alert:
        log_audit(
            db,
            user_id=device.user_id,
            device_id=device.id,
            action="INTRUDER_ALERT_CAPTURED",
            resource=f"snapshot:{snap.id}",
            details="Intruder selfie captured after 3 failed PIN unlock attempts!"
        )

    # Broadcast websocket update to dashboard
    await manager.send_to_user(device.user_id, {
        "event": "INTRUDER_ALERT" if snap.is_intruder_alert else "NEW_SNAPSHOT",
        "device_id": device.id,
        "snapshot_id": snap.id,
        "is_intruder_alert": snap.is_intruder_alert,
        "timestamp": snap.timestamp.isoformat()
    })

    return snap

@router.get("/{device_id}/snapshots", response_model=List[SnapshotResponse])
def list_snapshots(
    device: Device = Depends(verify_device_ownership),
    db: Session = Depends(get_db)
):
    snapshots = (
        db.query(Snapshot)
        .filter(Snapshot.device_id == device.id)
        .order_by(Snapshot.timestamp.desc())
        .limit(50)
        .all()
    )
    return snapshots
