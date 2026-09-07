import base64
from fastapi import APIRouter, Depends, HTTPException, status, Header, Response, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from app.database.session import get_db
from app.models.device import Device
from app.api.v1.deps import verify_device_ownership, get_current_user
from app.models.video_recording import VideoRecording
from app.services.websocket_manager import manager

router = APIRouter()

class VideoRecordingUploadPayload(BaseModel):
    video_data: str  # Base64 MP4 video
    thumbnail_data: Optional[str] = None  # Base64 JPEG thumbnail
    mime_type: Optional[str] = "video/mp4"
    duration_seconds: Optional[float] = 10.0
    facing: Optional[str] = "FRONT"
    file_size_bytes: Optional[int] = 0

@router.post("/{device_id}/video/recordings", status_code=status.HTTP_201_CREATED)
async def upload_video_recording(
    device_id: str,
    payload: VideoRecordingUploadPayload,
    x_device_token: str = Header(..., alias="X-Device-Token"),
    db: Session = Depends(get_db)
):
    """
    Receives an HD Video+Audio recording file captured on the device, saves it, and notifies the dashboard.
    """
    device = db.query(Device).filter(Device.id == device_id, Device.device_token == x_device_token).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid device credentials")

    if device.enrollment_status == "REVOKED":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Device enrollment has been revoked")

    recording = VideoRecording(
        device_id=device.id,
        user_id=device.user_id,
        video_data=payload.video_data,
        thumbnail_data=payload.thumbnail_data,
        mime_type=payload.mime_type or "video/mp4",
        duration_seconds=payload.duration_seconds or 10.0,
        facing=payload.facing or "FRONT",
        file_size_bytes=payload.file_size_bytes or len(payload.video_data)
    )
    db.add(recording)
    db.commit()
    db.refresh(recording)

    # Broadcast real-time notification to user dashboard
    await manager.send_to_user(device.user_id, {
        "event": "NEW_VIDEO_RECORDING",
        "device_id": device.id,
        "recording_id": recording.id,
        "duration_seconds": recording.duration_seconds,
        "facing": recording.facing,
        "thumbnail_data": recording.thumbnail_data,
        "created_at": recording.created_at.isoformat()
    })

    return {
        "status": "success",
        "recording_id": recording.id,
        "created_at": recording.created_at.isoformat()
    }

@router.get("/{device_id}/video/recordings")
def list_video_recordings(
    device: Device = Depends(verify_device_ownership),
    db: Session = Depends(get_db)
):
    recordings = db.query(VideoRecording).filter(
        VideoRecording.device_id == device.id
    ).order_by(VideoRecording.created_at.desc()).limit(50).all()

    return [
        {
            "id": r.id,
            "device_id": r.device_id,
            "video_data": r.video_data,
            "thumbnail_data": r.thumbnail_data,
            "mime_type": r.mime_type,
            "duration_seconds": r.duration_seconds,
            "facing": r.facing,
            "file_size_bytes": r.file_size_bytes,
            "created_at": r.created_at.isoformat()
        }
        for r in recordings
    ]

@router.delete("/{device_id}/video/recordings/{recording_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_video_recording(
    recording_id: str,
    device: Device = Depends(verify_device_ownership),
    db: Session = Depends(get_db)
):
    rec = db.query(VideoRecording).filter(
        VideoRecording.id == recording_id,
        VideoRecording.device_id == device.id
    ).first()
    if not rec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video recording not found")

    db.delete(rec)
    db.commit()
    return None

@router.get("/{device_id}/video/recordings/{recording_id}/stream")
def stream_video_recording(
    recording_id: str,
    request: Request,
    device: Device = Depends(verify_device_ownership),
    db: Session = Depends(get_db)
):
    """
    Direct binary streaming endpoint for native browser <video> playback with HTTP range & seek support.
    """
    rec = db.query(VideoRecording).filter(
        VideoRecording.id == recording_id,
        VideoRecording.device_id == device.id
    ).first()
    if not rec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video recording not found")

    raw_b64 = rec.video_data
    if "base64," in raw_b64:
        raw_b64 = raw_b64.split("base64,")[1]

    try:
        video_bytes = base64.b64decode(raw_b64)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Corrupt video payload")

    file_size = len(video_bytes)
    range_header = request.headers.get("Range")

    if range_header:
        # Parse range header: e.g. "bytes=0-1024"
        try:
            h_val = range_header.strip().lower()
            if h_val.startswith("bytes="):
                range_str = h_val[6:]
                parts = range_str.split("-")
                start = int(parts[0]) if parts[0] else 0
                end = int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1
                if start >= file_size:
                    start = file_size - 1
                if end >= file_size:
                    end = file_size - 1
                content_length = end - start + 1
                chunk = video_bytes[start:end + 1]

                return Response(
                    content=chunk,
                    status_code=status.HTTP_206_PARTIAL_CONTENT,
                    media_type=rec.mime_type or "video/mp4",
                    headers={
                        "Content-Range": f"bytes {start}-{end}/{file_size}",
                        "Accept-Ranges": "bytes",
                        "Content-Length": str(content_length),
                        "Content-Disposition": f"inline; filename=video_{recording_id}.mp4",
                        "Cache-Control": "public, max-age=86400"
                    }
                )
        except Exception:
            pass

    return Response(
        content=video_bytes,
        media_type=rec.mime_type or "video/mp4",
        headers={
            "Content-Disposition": f"inline; filename=video_{recording_id}.mp4",
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Cache-Control": "public, max-age=86400"
        }
    )
