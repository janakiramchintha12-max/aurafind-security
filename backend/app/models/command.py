from datetime import datetime, timezone, timedelta
from sqlalchemy import Column, String, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.database.session import Base
import uuid

class Command(Base):
    __tablename__ = "commands"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    device_id = Column(String, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    
    command_type = Column(String, nullable=False) # LOCATE_NOW, HIGH_ACCURACY_MODE, PLAY_ALARM, DISPLAY_MESSAGE, REFRESH_STATUS, FORCE_SYNC, TOGGLE_TRACKING
    status = Column(String, nullable=False, default="PENDING") # PENDING, SENT, EXECUTED, FAILED, EXPIRED
    payload = Column(Text, nullable=True, default="{}") # JSON parameters
    result = Column(Text, nullable=True) # Execution response or error details from client
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    executed_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, default=lambda: datetime.now(timezone.utc) + timedelta(hours=1))

    device = relationship("Device", back_populates="commands")
