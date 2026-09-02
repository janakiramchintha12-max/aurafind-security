from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, Boolean, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship
from app.database.session import Base
import uuid

class Location(Base):
    __tablename__ = "locations"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    device_id = Column(String, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    accuracy = Column(Float, nullable=True, default=0.0)
    altitude = Column(Float, nullable=True)
    speed = Column(Float, nullable=True)
    bearing = Column(Float, nullable=True)
    provider = Column(String, nullable=False, default="gps")
    battery_level = Column(Float, nullable=True)
    
    is_offline_record = Column(Boolean, nullable=False, default=False)
    is_battery_beacon = Column(Boolean, nullable=False, default=False) # 5% Low Battery Emergency Fix
    client_timestamp = Column(DateTime, nullable=False, index=True)
    server_timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    sync_batch_id = Column(String, nullable=True)

    device = relationship("Device", back_populates="locations")

    __table_args__ = (
        Index("idx_device_client_time", "device_id", "client_timestamp"),
    )
