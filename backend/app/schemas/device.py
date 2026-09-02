from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional

class DeviceRegister(BaseModel):
    device_name: str
    device_model: Optional[str] = "Unknown Model"
    android_version: Optional[str] = "Unknown"
    app_version: Optional[str] = "1.0.0"

class DeviceStatusUpdate(BaseModel):
    battery_pct: Optional[float] = None
    is_charging: Optional[bool] = None
    network_type: Optional[str] = None
    wifi_status: Optional[bool] = None
    sim_status: Optional[bool] = None
    sim_number: Optional[str] = None
    gps_status: Optional[bool] = None
    permission_status: Optional[str] = None
    tracking_mode: Optional[str] = None
    is_tracking_enabled: Optional[bool] = None
    is_lost_mode: Optional[bool] = None
    lost_mode_message: Optional[str] = None

class DeviceUpdate(BaseModel):
    device_name: Optional[str] = None
    tracking_mode: Optional[str] = None
    is_tracking_enabled: Optional[bool] = None
    is_lost_mode: Optional[bool] = None
    lost_mode_message: Optional[str] = None

class DeviceResponse(BaseModel):
    id: str
    user_id: str
    device_name: str
    device_model: str
    android_version: str
    app_version: str
    device_token: str
    
    battery_pct: Optional[float] = 100.0
    is_charging: bool = False
    network_type: str = "UNKNOWN"
    wifi_status: bool = False
    sim_status: bool = False
    sim_number: Optional[str] = None
    gps_status: bool = False
    
    last_latitude: Optional[float] = None
    last_longitude: Optional[float] = None
    last_accuracy: Optional[float] = None
    last_location_time: Optional[datetime] = None
    
    last_sync_time: Optional[datetime] = None
    last_heartbeat: Optional[datetime] = None
    status: str = "OFFLINE"
    permission_status: Optional[str] = "{}"
    tracking_mode: str = "NORMAL"
    is_tracking_enabled: bool = True

    is_lost_mode: bool = False
    lost_mode_message: Optional[str] = "This device is reported lost. Please contact the owner."

    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
