from datetime import datetime, timezone, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Header, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_
from app.database.session import get_db
from app.models.user import User
from app.models.device import Device
from app.models.location import Location
from app.schemas.location import LocationCreate, LocationBatchCreate, LocationResponse, SyncBatchResponse
from app.api.v1.deps import get_current_user, verify_device_ownership
from app.services.geofence_service import check_geofences_for_location
from app.services.websocket_manager import manager
import uuid

router = APIRouter()

@router.post("/{device_id}/locations", response_model=LocationResponse, status_code=status.HTTP_201_CREATED)
async def create_location(
    location_in: LocationCreate,
    device_id: str,
    x_device_token: str = Header(..., alias="X-Device-Token"),
    db: Session = Depends(get_db)
):
    device = db.query(Device).filter(Device.id == device_id, Device.device_token == x_device_token).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid device credentials")

    # Duplicate check within 2 seconds
    client_dt = location_in.client_timestamp
    if client_dt.tzinfo is None:
        client_dt = client_dt.replace(tzinfo=timezone.utc)

    existing = db.query(Location).filter(
        Location.device_id == device_id,
        Location.client_timestamp >= client_dt - timedelta(seconds=2),
        Location.client_timestamp <= client_dt + timedelta(seconds=2)
    ).first()

    if existing:
        return existing

    loc = Location(
        device_id=device_id,
        latitude=location_in.latitude,
        longitude=location_in.longitude,
        accuracy=location_in.accuracy,
        altitude=location_in.altitude,
        speed=location_in.speed,
        bearing=location_in.bearing,
        provider=location_in.provider or "gps",
        battery_level=location_in.battery_level,
        is_offline_record=location_in.is_offline_record,
        client_timestamp=client_dt,
        server_timestamp=datetime.now(timezone.utc)
    )
    db.add(loc)

    # Update device last location
    device.last_latitude = loc.latitude
    device.last_longitude = loc.longitude
    device.last_accuracy = loc.accuracy
    device.last_location_time = loc.client_timestamp
    device.last_sync_time = datetime.now(timezone.utc)
    device.status = "ONLINE"
    if loc.battery_level is not None:
        device.battery_pct = loc.battery_level

    db.commit()
    db.refresh(loc)

    # Geofence check
    check_geofences_for_location(db, device.user_id, device.id, loc.latitude, loc.longitude)

    # Broadcast real-time update
    await manager.send_to_user(device.user_id, {
        "event": "NEW_LOCATION",
        "device_id": device.id,
        "latitude": loc.latitude,
        "longitude": loc.longitude,
        "accuracy": loc.accuracy,
        "battery_level": loc.battery_level,
        "client_timestamp": loc.client_timestamp.isoformat(),
        "is_offline_record": loc.is_offline_record
    })

    return loc

@router.post("/{device_id}/locations/batch", response_model=SyncBatchResponse)
async def batch_upload_locations(
    batch_in: LocationBatchCreate,
    device_id: str,
    x_device_token: str = Header(..., alias="X-Device-Token"),
    db: Session = Depends(get_db)
):
    device = db.query(Device).filter(Device.id == device_id, Device.device_token == x_device_token).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid device credentials")

    batch_id = str(uuid.uuid4())
    processed_count = 0
    ignored_duplicates = 0
    latest_loc = None

    # Sort batch chronologically
    sorted_locs = sorted(batch_in.locations, key=lambda x: x.client_timestamp)

    for item in sorted_locs:
        client_dt = item.client_timestamp
        if client_dt.tzinfo is None:
            client_dt = client_dt.replace(tzinfo=timezone.utc)

        # Deduplication check
        existing = db.query(Location).filter(
            Location.device_id == device_id,
            Location.client_timestamp >= client_dt - timedelta(seconds=1),
            Location.client_timestamp <= client_dt + timedelta(seconds=1)
        ).first()

        if existing:
            ignored_duplicates += 1
            continue

        loc = Location(
            device_id=device_id,
            latitude=item.latitude,
            longitude=item.longitude,
            accuracy=item.accuracy,
            altitude=item.altitude,
            speed=item.speed,
            bearing=item.bearing,
            provider=item.provider or "gps",
            battery_level=item.battery_level,
            is_offline_record=item.is_offline_record,
            client_timestamp=client_dt,
            server_timestamp=datetime.now(timezone.utc),
            sync_batch_id=batch_id
        )
        db.add(loc)
        processed_count += 1
        latest_loc = loc

    if latest_loc:
        device.last_latitude = latest_loc.latitude
        device.last_longitude = latest_loc.longitude
        device.last_accuracy = latest_loc.accuracy
        device.last_location_time = latest_loc.client_timestamp
        device.last_sync_time = datetime.now(timezone.utc)
        device.status = "ONLINE"
        if latest_loc.battery_level is not None:
            device.battery_pct = latest_loc.battery_level
        check_geofences_for_location(db, device.user_id, device.id, latest_loc.latitude, latest_loc.longitude)

    db.commit()

    # Broadcast batch sync completion event to dashboard
    if processed_count > 0:
        await manager.send_to_user(device.user_id, {
            "event": "OFFLINE_LOCATIONS_SYNCED",
            "device_id": device.id,
            "synced_count": processed_count,
            "latest_latitude": device.last_latitude,
            "latest_longitude": device.last_longitude,
            "last_location_time": device.last_location_time.isoformat() if device.last_location_time else None
        })

    return SyncBatchResponse(
        processed_count=processed_count,
        ignored_duplicates=ignored_duplicates,
        message=f"Successfully synchronized {processed_count} locations ({ignored_duplicates} duplicates skipped)."
    )

@router.get("/{device_id}/locations", response_model=List[LocationResponse])
def get_location_history(
    device_id: str,
    range: Optional[str] = Query("today"), # today, yesterday, 7days, 30days, custom
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    limit: int = Query(500, ge=1, le=5000),
    device: Device = Depends(verify_device_ownership),
    db: Session = Depends(get_db)
):
    now = datetime.now(timezone.utc)
    query = db.query(Location).filter(Location.device_id == device_id)

    if range == "today":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        query = query.filter(Location.client_timestamp >= start)
    elif range == "yesterday":
        start = (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        end = now.replace(hour=0, minute=0, second=0, microsecond=0)
        query = query.filter(and_(Location.client_timestamp >= start, Location.client_timestamp < end))
    elif range == "7days":
        start = now - timedelta(days=7)
        query = query.filter(Location.client_timestamp >= start)
    elif range == "30days":
        start = now - timedelta(days=30)
        query = query.filter(Location.client_timestamp >= start)
    elif range == "custom" and start_date and end_date:
        query = query.filter(and_(Location.client_timestamp >= start_date, Location.client_timestamp <= end_date))

    locations = query.order_by(Location.client_timestamp.asc()).limit(limit).all()
    return locations
