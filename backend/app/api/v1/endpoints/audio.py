from fastapi import APIRouter, Depends, HTTPException, status, Header
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List, Dict
from collections import deque
from app.database.session import get_db
from app.models.device import Device
from app.api.v1.deps import verify_device_ownership, get_current_user
from app.models.user import User
from app.services.websocket_manager import manager

router = APIRouter()

class AudioChunkPayload(BaseModel):
    audio_data: str  # Base64 PCM 16-bit
    direction: Optional[str] = "DEVICE_TO_DASHBOARD"  # or "DASHBOARD_TO_DEVICE"
    timestamp: Optional[str] = None

# In-memory fast ring-buffers for real-time duplex audio packets
device_to_dashboard_buffers: Dict[str, deque] = {}
dashboard_to_device_buffers: Dict[str, deque] = {}

def get_buffer(buf_dict: Dict[str, deque], key: str) -> deque:
    if key not in buf_dict:
        buf_dict[key] = deque(maxlen=40) # Max 40 chunks (~1.5s buffer)
    return buf_dict[key]

@router.post("/{device_id}/audio/chunk", status_code=status.HTTP_200_OK)
async def push_audio_chunk(
    device_id: str,
    payload: AudioChunkPayload,
    x_device_token: Optional[str] = Header(None, alias="X-Device-Token"),
    db: Session = Depends(get_db)
):
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    if payload.direction == "DEVICE_TO_DASHBOARD":
        buf = get_buffer(device_to_dashboard_buffers, device_id)
        buf.append(payload.audio_data)

        # Broadcast real-time audio chunk to web dashboard via WebSocket
        await manager.send_to_user(device.user_id, {
            "event": "INCOMING_AUDIO_CHUNK",
            "device_id": device_id,
            "audio_data": payload.audio_data
        })
    else:
        buf = get_buffer(dashboard_to_device_buffers, device_id)
        buf.append(payload.audio_data)

    return {"status": "ok"}

@router.post("/{device_id}/audio/dashboard_send", status_code=status.HTTP_200_OK)
async def send_dashboard_audio(
    payload: AudioChunkPayload,
    device: Device = Depends(verify_device_ownership)
):
    buf = get_buffer(dashboard_to_device_buffers, device.id)
    buf.append(payload.audio_data)
    return {"status": "ok"}

@router.get("/{device_id}/audio/incoming")
def poll_incoming_audio_for_device(
    device_id: str,
    x_device_token: str = Header(..., alias="X-Device-Token"),
    db: Session = Depends(get_db)
) -> List[str]:
    buf = get_buffer(dashboard_to_device_buffers, device_id)
    chunks = []
    while buf:
        chunks.append(buf.popleft())
    return chunks

@router.get("/{device_id}/audio/dashboard_poll")
def poll_incoming_audio_for_dashboard(
    device: Device = Depends(verify_device_ownership)
) -> List[str]:
    buf = get_buffer(device_to_dashboard_buffers, device.id)
    chunks = []
    while buf:
        chunks.append(buf.popleft())
    return chunks
