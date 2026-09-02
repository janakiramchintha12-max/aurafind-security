import math
from typing import List, Tuple
from sqlalchemy.orm import Session
from app.models.geofence import Geofence, GeofenceEvent
from app.models.location import Location

def haversine_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = math.sin(delta_phi / 2.0)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0)**2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))

    return R * c

def check_geofences_for_location(db: Session, user_id: str, device_id: str, latitude: float, longitude: float) -> List[GeofenceEvent]:
    user_geofences = db.query(Geofence).filter(Geofence.user_id == user_id).all()
    events_triggered = []

    for gf in user_geofences:
        dist = haversine_distance_meters(latitude, longitude, gf.latitude, gf.longitude)
        is_inside = dist <= gf.radius_meters

        # Check last event for this device and geofence
        last_event = (
            db.query(GeofenceEvent)
            .filter(GeofenceEvent.geofence_id == gf.id, GeofenceEvent.device_id == device_id)
            .order_by(GeofenceEvent.timestamp.desc())
            .first()
        )

        triggered_type = None
        if is_inside and (last_event is None or last_event.event_type == "EXIT"):
            triggered_type = "ENTER"
        elif not is_inside and last_event is not None and last_event.event_type == "ENTER":
            triggered_type = "EXIT"

        if triggered_type:
            event = GeofenceEvent(
                geofence_id=gf.id,
                device_id=device_id,
                event_type=triggered_type,
                latitude=latitude,
                longitude=longitude
            )
            db.add(event)
            events_triggered.append(event)

    if events_triggered:
        db.commit()

    return events_triggered
