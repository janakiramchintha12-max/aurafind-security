from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional

class AuditLogResponse(BaseModel):
    id: str
    user_id: Optional[str] = None
    device_id: Optional[str] = None
    action: str
    resource: str
    ip_address: Optional[str] = None
    details: Optional[str] = None
    timestamp: datetime

    model_config = ConfigDict(from_attributes=True)
