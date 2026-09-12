from fastapi import APIRouter, Depends, HTTPException, status, Header
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional, Dict
from app.database.session import get_db
from app.models.device import Device
from app.api.v1.deps import verify_device_ownership
from app.services.websocket_manager import manager

router = APIRouter()

class AppUsageItem(BaseModel):
    package_name: str
    app_name: str
    total_time_foreground_seconds: int
    last_time_used: Optional[str] = None
    icon_base64: Optional[str] = None

class AppUsageReportRequest(BaseModel):
    date: str
    total_screen_time_seconds: int
    apps: List[AppUsageItem]

class ChildNotificationItem(BaseModel):
    package_name: str
    app_name: str
    title: str
    text: str
    timestamp: str

class NotificationBatchRequest(BaseModel):
    notifications: List[ChildNotificationItem]

# In-memory storage for child usage & notification streams
latest_device_usage: Dict[str, dict] = {}
latest_device_notifications: Dict[str, list] = {}

@router.post("/{device_id}/usage", status_code=status.HTTP_200_OK)
async def submit_app_usage(
    device_id: str,
    report: AppUsageReportRequest,
    x_device_token: str = Header(..., alias="X-Device-Token"),
    db: Session = Depends(get_db)
):
    device = db.query(Device).filter(Device.id == device_id, Device.device_token == x_device_token).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid device credentials")

    latest_device_usage[device_id] = report.dict()

    await manager.send_to_user(device.user_id, {
        "event": "CHILD_USAGE_REPORT",
        "device_id": device_id,
        "report": report.dict()
    })

    return {"status": "recorded"}

@router.get("/{device_id}/usage")
def get_app_usage(
    device: Device = Depends(verify_device_ownership),
    db: Session = Depends(get_db)
):
    usage = latest_device_usage.get(device.id)
    if not usage:
        return {"has_report": False, "report": None}
    return {"has_report": True, "report": usage}

@router.post("/{device_id}/notifications/batch", status_code=status.HTTP_200_OK)
async def submit_notifications(
    device_id: str,
    request: NotificationBatchRequest,
    x_device_token: str = Header(..., alias="X-Device-Token"),
    db: Session = Depends(get_db)
):
    device = db.query(Device).filter(Device.id == device_id, Device.device_token == x_device_token).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid device credentials")

    if device_id not in latest_device_notifications:
        latest_device_notifications[device_id] = []

    for n in request.notifications:
        latest_device_notifications[device_id].insert(0, n.dict())

    # Keep latest 100 notifications
    latest_device_notifications[device_id] = latest_device_notifications[device_id][:100]

    await manager.send_to_user(device.user_id, {
        "event": "CHILD_NOTIFICATIONS_BATCH",
        "device_id": device_id,
        "notifications": [n.dict() for n in request.notifications]
    })

    return {"status": "recorded", "count": len(request.notifications)}

@router.get("/{device_id}/notifications")
def get_notifications(
    device: Device = Depends(verify_device_ownership),
    db: Session = Depends(get_db)
):
    notifs = latest_device_notifications.get(device.id, [])
    return {"notifications": notifs}
