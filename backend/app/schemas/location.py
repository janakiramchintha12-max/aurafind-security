from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional, List

class LocationCreate(BaseModel):
    latitude: float
    longitude: float
    accuracy: Optional[float] = 0.0
    altitude: Optional[float] = None
    speed: Optional[float] = None
    bearing: Optional[float] = None
    provider: Optional[str] = "gps"
    battery_level: Optional[float] = None
    is_offline_record: bool = False
    is_battery_beacon: bool = False
    client_timestamp: datetime

class LocationBatchCreate(BaseModel):
    locations: List[LocationCreate]

class LocationResponse(BaseModel):
    id: str
    device_id: str
    latitude: float
    longitude: float
    accuracy: Optional[float] = 0.0
    altitude: Optional[float] = None
    speed: Optional[float] = None
    bearing: Optional[float] = None
    provider: str = "gps"
    battery_level: Optional[float] = None
    is_offline_record: bool = False
    is_battery_beacon: bool = False
    client_timestamp: datetime
    server_timestamp: datetime
    sync_batch_id: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

class SyncBatchResponse(BaseModel):
    processed_count: int
    ignored_duplicates: int
    message: str
