from fastapi import APIRouter, Depends, HTTPException, status, Header, Body
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from app.database.session import get_db
from app.models.device import Device
from app.api.v1.deps import verify_device_ownership
from app.services.websocket_manager import manager

router = APIRouter()

class CameraFramePayload(BaseModel):
    image_data: str  # Base64 data URL or JPEG string
    facing: Optional[str] = "FRONT"  # "FRONT" or "BACK"
    fps: Optional[float] = 10.0
    timestamp: Optional[str] = None

# In-memory latest frame cache for instant dashboard polling/preview
latest_device_frames = {}

@router.post("/{device_id}/camera/frame", status_code=status.HTTP_200_OK)
async def push_camera_frame(
    device_id: str,
    payload: CameraFramePayload,
    x_device_token: str = Header(..., alias="X-Device-Token"),
    db: Session = Depends(get_db)
):
    device = db.query(Device).filter(Device.id == device_id, Device.device_token == x_device_token).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid device credentials")

    latest_device_frames[device_id] = {
        "image_data": payload.image_data,
        "facing": payload.facing,
        "fps": payload.fps,
        "timestamp": payload.timestamp
    }

    # Broadcast live frame to web dashboard
    await manager.send_to_user(device.user_id, {
        "event": "LIVE_CAMERA_FRAME",
        "device_id": device_id,
        "image_data": payload.image_data,
        "facing": payload.facing,
        "fps": payload.fps,
        "timestamp": payload.timestamp
    })

    return {"status": "broadcasted"}

@router.get("/{device_id}/camera/latest")
def get_latest_camera_frame(
    device: Device = Depends(verify_device_ownership)
):
    frame = latest_device_frames.get(device.id)
    if not frame:
        return {"has_frame": False, "image_data": None, "facing": "FRONT"}
    return {"has_frame": True, **frame}
