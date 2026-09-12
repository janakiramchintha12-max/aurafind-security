import asyncio
import base64
from fastapi import APIRouter, Depends, HTTPException, status, Header, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, Dict, Set
from app.database.session import get_db
from app.models.device import Device
from app.api.v1.deps import verify_device_ownership
from app.services.websocket_manager import manager

router = APIRouter()

class ScreenFramePayload(BaseModel):
    image_data: str  # Base64 data URL or JPEG string
    fps: Optional[float] = 20.0
    timestamp: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None

# In-memory latest screen frame cache per device
latest_screen_frames: Dict[str, dict] = {}
# Active MJPEG screen stream subscriber queues per device
screen_stream_queues: Dict[str, Set[asyncio.Queue]] = {}
screen_auth_cache: Dict[str, str] = {}
screen_frame_seq: int = 0

@router.post("/{device_id}/screen/frame", status_code=status.HTTP_200_OK)
async def push_screen_frame(
    device_id: str,
    payload: ScreenFramePayload,
    x_device_token: str = Header(..., alias="X-Device-Token"),
    db: Session = Depends(get_db)
):
    global screen_frame_seq
    screen_frame_seq += 1

    user_id = screen_auth_cache.get(f"{device_id}:{x_device_token}")
    if not user_id:
        device = db.query(Device).filter(Device.id == device_id, Device.device_token == x_device_token).first()
        if not device:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid device credentials")
        if device.enrollment_status == "REVOKED":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Device enrollment has been revoked")
        user_id = device.user_id
        screen_auth_cache[f"{device_id}:{x_device_token}"] = user_id

    frame_obj = {
        "image_data": payload.image_data,
        "fps": payload.fps,
        "timestamp": payload.timestamp,
        "width": payload.width,
        "height": payload.height,
        "seq": screen_frame_seq
    }
    latest_screen_frames[device_id] = frame_obj

    # 1. Notify all active MJPEG screen subscribers
    if device_id in screen_stream_queues:
        for q in list(screen_stream_queues[device_id]):
            try:
                if q.full():
                    try:
                        q.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                q.put_nowait(payload.image_data)
            except Exception:
                pass

    # 2. Broadcast live screen frame to parent dashboard WebSockets
    await manager.send_to_user(user_id, {
        "event": "LIVE_SCREEN_FRAME",
        "device_id": device_id,
        "image_data": payload.image_data,
        "fps": payload.fps,
        "timestamp": payload.timestamp,
        "width": payload.width,
        "height": payload.height,
        "seq": screen_frame_seq
    })

    return {"status": "broadcasted", "seq": screen_frame_seq}

@router.get("/{device_id}/screen/latest")
def get_latest_screen_frame(
    device: Device = Depends(verify_device_ownership),
    db: Session = Depends(get_db)
):
    if device.enrollment_status == "REVOKED":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Device enrollment has been revoked")

    frame = latest_screen_frames.get(device.id)
    if not frame:
        return {"has_frame": False, "image_data": None}
    return {"has_frame": True, **frame}

@router.get("/{device_id}/screen/mjpeg")
async def stream_mjpeg_screen(
    device_id: str,
    token: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Ultra-Smooth Native C++ MJPEG Screen Mirroring Stream
    Yields multipart/x-mixed-replace screen frames directly to browser img elements.
    """
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    if device.enrollment_status == "REVOKED":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Device enrollment has been revoked")

    queue = asyncio.Queue(maxsize=10)
    if device_id not in screen_stream_queues:
        screen_stream_queues[device_id] = set()
    screen_stream_queues[device_id].add(queue)

    async def frame_generator():
        try:
            initial_frame = latest_screen_frames.get(device_id)
            if initial_frame and initial_frame.get("image_data"):
                data_str = initial_frame["image_data"]
                if "," in data_str:
                    data_str = data_str.split(",", 1)[1]
                try:
                    raw_bytes = base64.b64decode(data_str)
                    yield (
                        b"--frame\r\n"
                        b"Content-Type: image/jpeg\r\n"
                        b"Content-Length: " + str(len(raw_bytes)).encode() + b"\r\n\r\n" +
                        raw_bytes + b"\r\n"
                    )
                except Exception:
                    pass

            while True:
                data_url = await queue.get()
                if not data_url:
                    continue
                if "," in data_url:
                    data_url = data_url.split(",", 1)[1]
                try:
                    raw_bytes = base64.b64decode(data_url)
                    yield (
                        b"--frame\r\n"
                        b"Content-Type: image/jpeg\r\n"
                        b"Content-Length: " + str(len(raw_bytes)).encode() + b"\r\n\r\n" +
                        raw_bytes + b"\r\n"
                    )
                except Exception:
                    continue
        except asyncio.CancelledError:
            pass
        finally:
            if device_id in screen_stream_queues:
                screen_stream_queues[device_id].discard(queue)
                if not screen_stream_queues[device_id]:
                    del screen_stream_queues[device_id]

    return StreamingResponse(
        frame_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )
