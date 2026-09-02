from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional

class SnapshotCreate(BaseModel):
    image_data: str # Base64 encoded JPEG
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    is_intruder_alert: bool = False

class SnapshotResponse(BaseModel):
    id: str
    device_id: str
    image_data: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    is_intruder_alert: bool = False
    timestamp: datetime

    model_config = ConfigDict(from_attributes=True)
