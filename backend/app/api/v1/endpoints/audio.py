import base64
from fastapi import APIRouter, Depends, HTTPException, status, Header, Response
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
    x_device_token: str = Header(..., alias="X-Device-Token"),
    db: Session = Depends(get_db)
):
    device = db.query(Device).filter(Device.id == device_id, Device.device_token == x_device_token).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid device credentials")

    if device.enrollment_status == "REVOKED":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Device enrollment has been revoked")

    if device.microphone_privacy_state == "PAUSED_BY_DEVICE_USER":
        device_to_dashboard_buffers.pop(device_id, None)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Microphone access is paused by device user. Audio chunk rejected."
        )

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
    if device.enrollment_status == "REVOKED":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Device enrollment has been revoked")

    if device.speaker_privacy_state == "PAUSED_BY_DEVICE_USER":
        dashboard_to_device_buffers.pop(device.id, None)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Loudspeaker is paused by device user. Outgoing audio rejected."
        )

    buf = get_buffer(dashboard_to_device_buffers, device.id)
    buf.append(payload.audio_data)
    return {"status": "ok"}

@router.get("/{device_id}/audio/incoming")
def poll_incoming_audio_for_device(
    device_id: str,
    x_device_token: str = Header(..., alias="X-Device-Token"),
    db: Session = Depends(get_db)
) -> List[str]:
    device = db.query(Device).filter(Device.id == device_id, Device.device_token == x_device_token).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid device credentials")

    if device.enrollment_status == "REVOKED":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Device enrollment has been revoked")

    if device.speaker_privacy_state == "PAUSED_BY_DEVICE_USER":
        dashboard_to_device_buffers.pop(device_id, None)
        return []

    buf = get_buffer(dashboard_to_device_buffers, device_id)
    chunks = []
    while buf:
        chunks.append(buf.popleft())
    return chunks

@router.get("/{device_id}/audio/dashboard_poll")
def poll_incoming_audio_for_dashboard(
    device: Device = Depends(verify_device_ownership)
) -> List[str]:
    if device.enrollment_status == "REVOKED":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Device enrollment has been revoked")

    if device.microphone_privacy_state == "PAUSED_BY_DEVICE_USER":
        device_to_dashboard_buffers.pop(device.id, None)
        return []

    buf = get_buffer(device_to_dashboard_buffers, device.id)
    chunks = []
    while buf:
        chunks.append(buf.popleft())
    return chunks

class AudioRecordingUploadPayload(BaseModel):
    audio_data: str
    mime_type: Optional[str] = "audio/mp4"
    duration_seconds: Optional[float] = 10.0

@router.post("/{device_id}/audio/recordings", status_code=status.HTTP_201_CREATED)
async def upload_audio_recording(
    device_id: str,
    payload: AudioRecordingUploadPayload,
    x_device_token: str = Header(..., alias="X-Device-Token"),
    db: Session = Depends(get_db)
):
    """
    Receives an HD audio recording file captured on the device, saves it, and notifies the dashboard.
    """
    from app.models.audio_recording import AudioRecording

    device = db.query(Device).filter(Device.id == device_id, Device.device_token == x_device_token).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid device credentials")

    if device.enrollment_status == "REVOKED":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Device enrollment has been revoked")

    recording = AudioRecording(
        device_id=device.id,
        user_id=device.user_id,
        audio_data=payload.audio_data,
        mime_type=payload.mime_type or "audio/mp4",
        duration_seconds=payload.duration_seconds or 10.0
    )
    db.add(recording)
    db.commit()
    db.refresh(recording)

    # Broadcast real-time notification to user dashboard
    await manager.send_to_user(device.user_id, {
        "event": "NEW_AUDIO_RECORDING",
        "device_id": device.id,
        "recording_id": recording.id,
        "duration_seconds": recording.duration_seconds,
        "created_at": recording.created_at.isoformat()
    })

    return {
        "status": "success",
        "recording_id": recording.id,
        "created_at": recording.created_at.isoformat()
    }

@router.get("/{device_id}/audio/recordings")
def list_audio_recordings(
    device: Device = Depends(verify_device_ownership),
    db: Session = Depends(get_db)
):
    from app.models.audio_recording import AudioRecording
    recordings = db.query(AudioRecording).filter(
        AudioRecording.device_id == device.id
    ).order_by(AudioRecording.created_at.desc()).limit(50).all()

    return [
        {
            "id": r.id,
            "device_id": r.device_id,
            "audio_data": r.audio_data,
            "mime_type": r.mime_type,
            "duration_seconds": r.duration_seconds,
            "created_at": r.created_at.isoformat()
        }
        for r in recordings
    ]

@router.delete("/{device_id}/audio/recordings/{recording_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_audio_recording(
    recording_id: str,
    device: Device = Depends(verify_device_ownership),
    db: Session = Depends(get_db)
):
    from app.models.audio_recording import AudioRecording
    rec = db.query(AudioRecording).filter(
        AudioRecording.id == recording_id,
        AudioRecording.device_id == device.id
    ).first()
    if not rec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audio recording not found")

    db.delete(rec)
    db.commit()
    return None

@router.get("/{device_id}/audio/recordings/{recording_id}/stream")
def stream_audio_recording(
    recording_id: str,
    device: Device = Depends(verify_device_ownership),
    db: Session = Depends(get_db)
):
    """
    Direct binary streaming endpoint for native browser <audio> playback with HTTP range & seek support.
    """
    from app.models.audio_recording import AudioRecording
    rec = db.query(AudioRecording).filter(
        AudioRecording.id == recording_id,
        AudioRecording.device_id == device.id
    ).first()
    if not rec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audio recording not found")

    raw_b64 = rec.audio_data
    if "base64," in raw_b64:
        raw_b64 = raw_b64.split("base64,")[1]

    try:
        audio_bytes = base64.b64decode(raw_b64)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Corrupt audio payload")

    return Response(
        content=audio_bytes,
        media_type=rec.mime_type or "audio/mp4",
        headers={
            "Content-Disposition": f"inline; filename=recording_{recording_id}.m4a",
            "Accept-Ranges": "bytes",
            "Content-Length": str(len(audio_bytes)),
            "Cache-Control": "public, max-age=86400"
        }
    )

