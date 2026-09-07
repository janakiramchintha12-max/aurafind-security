import asyncio
import base64
from fastapi import APIRouter, Depends, HTTPException, status, Header, Body, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, Dict, Set
from app.database.session import get_db
from app.models.device import Device
from app.api.v1.deps import verify_device_ownership, get_current_user
from app.services.websocket_manager import manager

router = APIRouter()

class CameraFramePayload(BaseModel):
    image_data: str  # Base64 data URL or JPEG string
    facing: Optional[str] = "FRONT"  # "FRONT" or "BACK"
    fps: Optional[float] = 20.0
    timestamp: Optional[str] = None

# In-memory latest frame cache for instant dashboard polling/preview
latest_device_frames: Dict[str, dict] = {}
# Active MJPEG subscriber queues per device
device_stream_queues: Dict[str, Set[asyncio.Queue]] = {}
# Fast token auth cache: (device_id, token) -> user_id
device_auth_cache: Dict[str, str] = {}
frame_seq_counter: int = 0

@router.post("/{device_id}/camera/frame", status_code=status.HTTP_200_OK)
async def push_camera_frame(
    device_id: str,
    payload: CameraFramePayload,
    x_device_token: str = Header(..., alias="X-Device-Token"),
    db: Session = Depends(get_db)
):
    global frame_seq_counter
    frame_seq_counter += 1

    user_id = device_auth_cache.get(f"{device_id}:{x_device_token}")
    if not user_id:
        device = db.query(Device).filter(Device.id == device_id, Device.device_token == x_device_token).first()
        if not device:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid device credentials")
        if device.enrollment_status == "REVOKED":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Device enrollment has been revoked")
        if device.camera_privacy_state == "PAUSED_BY_DEVICE_USER":
            latest_device_frames.pop(device_id, None)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Camera access is paused by device user. Frame rejected."
            )
        user_id = device.user_id
        device_auth_cache[f"{device_id}:{x_device_token}"] = user_id

    frame_obj = {
        "image_data": payload.image_data,
        "facing": payload.facing,
        "fps": payload.fps,
        "timestamp": payload.timestamp,
        "seq": frame_seq_counter
    }
    latest_device_frames[device_id] = frame_obj

    # 1. Notify all active MJPEG stream subscribers
    if device_id in device_stream_queues:
        for q in list(device_stream_queues[device_id]):
            try:
                if q.full():
                    try:
                        q.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                q.put_nowait(payload.image_data)
            except Exception:
                pass

    # 2. Broadcast live frame to web dashboard WebSockets
    await manager.send_to_user(user_id, {
        "event": "LIVE_CAMERA_FRAME",
        "device_id": device_id,
        "image_data": payload.image_data,
        "facing": payload.facing,
        "fps": payload.fps,
        "timestamp": payload.timestamp,
        "seq": frame_seq_counter
    })

    return {"status": "broadcasted", "seq": frame_seq_counter}

@router.get("/{device_id}/camera/latest")
def get_latest_camera_frame(
    device: Device = Depends(verify_device_ownership),
    db: Session = Depends(get_db)
):
    if device.enrollment_status == "REVOKED":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Device enrollment has been revoked")

    if device.camera_privacy_state == "PAUSED_BY_DEVICE_USER":
        return {"has_frame": False, "image_data": None, "facing": "FRONT", "privacy_state": "PAUSED_BY_DEVICE_USER"}

    frame = latest_device_frames.get(device.id)
    if not frame:
        from app.models.snapshot import Snapshot
        snap = db.query(Snapshot).filter(Snapshot.device_id == device.id).order_by(Snapshot.timestamp.desc()).first()
        if snap and snap.image_data:
            return {
                "has_frame": True,
                "image_data": snap.image_data,
                "facing": "FRONT",
                "fps": 1.0,
                "timestamp": snap.timestamp.isoformat() if snap.timestamp else None,
                "privacy_state": device.camera_privacy_state
            }
        return {"has_frame": False, "image_data": None, "facing": "FRONT", "privacy_state": device.camera_privacy_state}
    return {"has_frame": True, **frame, "privacy_state": device.camera_privacy_state}

@router.get("/{device_id}/camera/mjpeg")
async def stream_mjpeg_video(
    device_id: str,
    token: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Ultra-Smooth Native C++ MJPEG Streaming Endpoint
    Yields multipart/x-mixed-replace frames directly to browser <img> elements with zero JS DOM lag.
    """
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    if device.enrollment_status == "REVOKED":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Device enrollment has been revoked")

    if device.camera_privacy_state == "PAUSED_BY_DEVICE_USER":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Camera access is paused by device user")

    queue = asyncio.Queue(maxsize=10)
    if device_id not in device_stream_queues:
        device_stream_queues[device_id] = set()
    device_stream_queues[device_id].add(queue)

    async def frame_generator():
        try:
            # Send initial latest frame if available
            initial_frame = latest_device_frames.get(device_id)
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
            if device_id in device_stream_queues:
                device_stream_queues[device_id].discard(queue)
                if not device_stream_queues[device_id]:
                    del device_stream_queues[device_id]

    return StreamingResponse(
        frame_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

