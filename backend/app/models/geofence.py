from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.database.session import Base
import uuid

class Geofence(Base):
    __tablename__ = "geofences"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    
    name = Column(String, nullable=False) # e.g., "Home", "Office", "University"
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    radius_meters = Column(Float, nullable=False, default=200.0)
    description = Column(Text, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    owner = relationship("User", back_populates="geofences")
    events = relationship("GeofenceEvent", back_populates="geofence", cascade="all, delete-orphan")


class GeofenceEvent(Base):
    __tablename__ = "geofence_events"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    geofence_id = Column(String, ForeignKey("geofences.id", ondelete="CASCADE"), nullable=False, index=True)
    device_id = Column(String, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    
    event_type = Column(String, nullable=False) # ENTER, EXIT
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

    geofence = relationship("Geofence", back_populates="events")
