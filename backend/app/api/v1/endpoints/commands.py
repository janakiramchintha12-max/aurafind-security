from datetime import datetime, timezone, timedelta
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, Header
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.user import User
from app.models.device import Device
from app.models.command import Command
from app.schemas.command import CommandCreate, CommandResultUpdate, CommandResponse
from app.api.v1.deps import get_current_user, verify_device_ownership, log_audit
from app.services.websocket_manager import manager

router = APIRouter()

ALLOWED_COMMAND_TYPES = {
    "LOCATE_NOW",
    "HIGH_ACCURACY_MODE",
    "PLAY_ALARM",
    "STOP_ALARM",
    "DISPLAY_MESSAGE",
    "REFRESH_STATUS",
    "FORCE_SYNC",
    "TOGGLE_TRACKING",
    "CAPTURE_SNAPSHOT",
    "ENABLE_LOST_MODE",
    "DISABLE_LOST_MODE",
    "SPEAK_TEXT",
    "START_CAMERA_STREAM",
    "STOP_CAMERA_STREAM",
    "SWITCH_CAMERA",
    "START_VOICE_CALL",
    "END_VOICE_CALL",
    "RECORD_AUDIO_CLIP",
    "RECORD_AUDIO",
    "START_AUDIO_RECORDING",
    "STOP_AUDIO_RECORDING",
    "STOP_AUDIO_CLIP",
    "START_VIDEO_RECORDING",
    "STOP_VIDEO_RECORDING"
}

@router.post("/{device_id}/commands", response_model=CommandResponse, status_code=status.HTTP_201_CREATED)
async def dispatch_command(
    command_in: CommandCreate,
    device: Device = Depends(verify_device_ownership),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if device.enrollment_status == "REVOKED":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Device enrollment has been revoked")

    if command_in.command_type not in ALLOWED_COMMAND_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid command_type. Allowed types: {sorted(list(ALLOWED_COMMAND_TYPES))}"
        )

    # Strict Device-Controlled Privacy & Consent Authorization Gate
    # Check if physical device user has paused the requested sensor/capability
    if command_in.command_type in {"START_CAMERA_STREAM", "SWITCH_CAMERA", "CAPTURE_SNAPSHOT", "START_VIDEO_RECORDING"}:
        if device.camera_privacy_state == "PAUSED_BY_DEVICE_USER":
            log_audit(db, user_id=current_user.id, device_id=device.id, action="REMOTE_CAMERA_REQUEST_REJECTED",
                      resource=f"device:{device.id}:camera",
                      details=f"Remote command '{command_in.command_type}' rejected: Camera access paused by physical device user.")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Camera remote access is paused by the physical device user."
            )

    if command_in.command_type in {"START_VOICE_CALL", "RECORD_AUDIO_CLIP", "RECORD_AUDIO", "START_AUDIO_RECORDING"}:
        if device.microphone_privacy_state == "PAUSED_BY_DEVICE_USER" and device.speaker_privacy_state == "PAUSED_BY_DEVICE_USER":
            detail_msg = "Microphone and speaker remote access is paused by the physical device user."
        elif device.microphone_privacy_state == "PAUSED_BY_DEVICE_USER":
            detail_msg = "Microphone remote access is paused by the physical device user."
        elif device.speaker_privacy_state == "PAUSED_BY_DEVICE_USER" and command_in.command_type == "START_VOICE_CALL":
            detail_msg = "Speaker remote access is paused by the physical device user."
        else:
            detail_msg = None

        if detail_msg:
            log_audit(db, user_id=current_user.id, device_id=device.id, action="REMOTE_MIC_REQUEST_REJECTED",
                      resource=f"device:{device.id}:mic",
                      details=f"Remote command '{command_in.command_type}' rejected: {detail_msg}")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=detail_msg
            )

    if command_in.command_type in {"SPEAK_TEXT", "PLAY_ALARM"}:
        if device.speaker_privacy_state == "PAUSED_BY_DEVICE_USER":
            log_audit(db, user_id=current_user.id, device_id=device.id, action="REMOTE_SPEAKER_REQUEST_REJECTED",
                      resource=f"device:{device.id}:speaker",
                      details=f"Remote command '{command_in.command_type}' rejected: Speaker/Siren paused by physical device user.")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Speaker and siren remote access is paused by the physical device user."
            )

    if command_in.command_type in {"LOCATE_NOW", "HIGH_ACCURACY_MODE", "FORCE_SYNC"}:
        if device.location_privacy_state == "PAUSED_BY_DEVICE_USER":
            log_audit(db, user_id=current_user.id, device_id=device.id, action="REMOTE_LOCATION_REQUEST_REJECTED",
                      resource=f"device:{device.id}:location",
                      details=f"Remote command '{command_in.command_type}' rejected: Location sharing paused by physical device user.")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Location remote sharing is paused by the physical device user."
            )

    if device.remote_controls_state == "RESTRICTED" and command_in.command_type not in {"STOP_ALARM", "STOP_CAMERA_STREAM", "END_VOICE_CALL"}:
        log_audit(db, user_id=current_user.id, device_id=device.id, action="REMOTE_CONTROLS_RESTRICTED",
                  resource=f"device:{device.id}:controls",
                  details=f"Command '{command_in.command_type}' rejected: Remote device controls are restricted.")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Remote device controls have been restricted by the physical device user."
        )

    # Automatically update lost mode flag if dispatching lost mode command
    if command_in.command_type == "ENABLE_LOST_MODE":
        device.is_lost_mode = True
    elif command_in.command_type == "DISABLE_LOST_MODE":
        device.is_lost_mode = False

    cmd = Command(
        device_id=device.id,
        user_id=current_user.id,
        command_type=command_in.command_type,
        payload=command_in.payload or "{}",
        status="PENDING",
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1)
    )
    db.add(cmd)
    db.commit()
    db.refresh(cmd)

    log_audit(
        db,
        user_id=current_user.id,
        device_id=device.id,
        action="COMMAND_DISPATCHED",
        resource=f"command:{cmd.id}",
        details=f"Type: {cmd.command_type}"
    )

    pushed = await manager.send_command_to_device(device.id, {
        "event": "REMOTE_COMMAND",
        "command_id": cmd.id,
        "command_type": cmd.command_type,
        "payload": cmd.payload
    })
    if pushed:
        cmd.status = "SENT"
        db.commit()

    return cmd

@router.get("/{device_id}/commands", response_model=List[CommandResponse])
def get_device_commands(
    device: Device = Depends(verify_device_ownership),
    db: Session = Depends(get_db)
):
    if device.enrollment_status == "REVOKED":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Device enrollment has been revoked")

    commands = (
        db.query(Command)
        .filter(Command.device_id == device.id)
        .order_by(Command.created_at.desc())
        .limit(100)
        .all()
    )
    return commands

@router.get("/{device_id}/commands/pending", response_model=List[CommandResponse])
def get_pending_commands_for_device(
    device_id: str,
    x_device_token: str = Header(..., alias="X-Device-Token"),
    db: Session = Depends(get_db)
):
    device = db.query(Device).filter(Device.id == device_id, Device.device_token == x_device_token).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid device credentials")

    if device.enrollment_status == "REVOKED":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Device enrollment has been revoked")

    now = datetime.now(timezone.utc)
    all_pending = (
        db.query(Command)
        .filter(
            Command.device_id == device_id,
            Command.status.in_(["PENDING", "SENT"]),
            Command.expires_at > now
        )
        .all()
    )

    valid_pending = []
    for cmd in all_pending:
        # Check if sensor was paused after command was dispatched (Stale Race Condition Prevention)
        is_invalid = False
        if cmd.command_type in {"START_CAMERA_STREAM", "SWITCH_CAMERA", "CAPTURE_SNAPSHOT", "START_VIDEO_RECORDING"} and device.camera_privacy_state == "PAUSED_BY_DEVICE_USER":
            is_invalid = True
        elif cmd.command_type in {"START_VOICE_CALL", "START_VIDEO_RECORDING"} and (device.microphone_privacy_state == "PAUSED_BY_DEVICE_USER" or device.speaker_privacy_state == "PAUSED_BY_DEVICE_USER"):
            is_invalid = True
        elif cmd.command_type in {"PLAY_ALARM", "SPEAK_TEXT"} and device.speaker_privacy_state == "PAUSED_BY_DEVICE_USER":
            is_invalid = True
        elif cmd.command_type in {"LOCATE_NOW", "HIGH_ACCURACY_MODE", "FORCE_SYNC"} and device.location_privacy_state == "PAUSED_BY_DEVICE_USER":
            is_invalid = True
        elif device.remote_controls_state == "RESTRICTED" and cmd.command_type not in {"STOP_ALARM", "STOP_CAMERA_STREAM", "END_VOICE_CALL", "STOP_VIDEO_RECORDING"}:
            is_invalid = True

        if is_invalid:
            cmd.status = "FAILED"
            cmd.result = "REJECTED: Sensor access was paused by device user prior to delivery"
            cmd.executed_at = now
        else:
            valid_pending.append(cmd)

    db.commit()
    return valid_pending

@router.patch("/{device_id}/commands/{command_id}/result", response_model=CommandResponse)
async def update_command_result(
    device_id: str,
    command_id: str,
    result_in: CommandResultUpdate,
    x_device_token: str = Header(..., alias="X-Device-Token"),
    db: Session = Depends(get_db)
):
    device = db.query(Device).filter(Device.id == device_id, Device.device_token == x_device_token).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid device credentials")

    if device.enrollment_status == "REVOKED":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Device enrollment has been revoked")

    cmd = db.query(Command).filter(Command.id == command_id, Command.device_id == device_id).first()
    if not cmd:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Command not found")

    cmd.status = result_in.status
    cmd.result = result_in.result
    cmd.executed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(cmd)

    await manager.send_to_user(device.user_id, {
        "event": "COMMAND_RESULT",
        "device_id": device_id,
        "command_id": command_id,
        "command_type": cmd.command_type,
        "status": cmd.status,
        "result": cmd.result
    })

    return cmd
