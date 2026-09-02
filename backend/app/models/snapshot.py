from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.database.session import Base
import uuid

class Snapshot(Base):
    __tablename__ = "snapshots"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    device_id = Column(String, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    
    image_data = Column(Text, nullable=False) # Base64 encoded JPEG image
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    is_intruder_alert = Column(Boolean, nullable=False, default=False)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

    device = relationship("Device", back_populates="snapshots")
