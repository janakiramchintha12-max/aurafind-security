from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional

class CommandCreate(BaseModel):
    command_type: str # LOCATE_NOW, HIGH_ACCURACY_MODE, PLAY_ALARM, DISPLAY_MESSAGE, REFRESH_STATUS, FORCE_SYNC, TOGGLE_TRACKING
    payload: Optional[str] = "{}"

class CommandResultUpdate(BaseModel):
    status: str # EXECUTED, FAILED
    result: Optional[str] = None

class CommandResponse(BaseModel):
    id: str
    device_id: str
    user_id: str
    command_type: str
    status: str
    payload: Optional[str] = "{}"
    result: Optional[str] = None
    created_at: datetime
    executed_at: Optional[datetime] = None
    expires_at: datetime

    model_config = ConfigDict(from_attributes=True)
