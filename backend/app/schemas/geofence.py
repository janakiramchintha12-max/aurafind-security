from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional

class GeofenceCreate(BaseModel):
    name: str
    latitude: float
    longitude: float
    radius_meters: Optional[float] = 200.0
    description: Optional[str] = None

class GeofenceResponse(BaseModel):
    id: str
    user_id: str
    name: str
    latitude: float
    longitude: float
    radius_meters: float
    description: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class GeofenceEventResponse(BaseModel):
    id: str
    geofence_id: str
    device_id: str
    event_type: str
    latitude: float
    longitude: float
    timestamp: datetime

    model_config = ConfigDict(from_attributes=True)
