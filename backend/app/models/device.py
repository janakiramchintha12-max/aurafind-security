from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.database.session import Base
import uuid

class Device(Base):
    __tablename__ = "devices"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    device_name = Column(String, nullable=False)
    device_model = Column(String, nullable=False, default="Unknown Model")
    android_version = Column(String, nullable=False, default="Unknown")
    app_version = Column(String, nullable=False, default="1.0.0")
    device_token = Column(String, nullable=False, unique=True, index=True, default=lambda: str(uuid.uuid4()))

    # Telemetry & Health
    battery_pct = Column(Float, nullable=True, default=100.0)
    is_charging = Column(Boolean, nullable=False, default=False)
    network_type = Column(String, nullable=False, default="UNKNOWN")
    wifi_status = Column(Boolean, nullable=False, default=False)
    sim_status = Column(Boolean, nullable=False, default=False)
    sim_number = Column(String, nullable=True, default=None)
    gps_status = Column(Boolean, nullable=False, default=False)
    
    # Location summary
    last_latitude = Column(Float, nullable=True)
    last_longitude = Column(Float, nullable=True)
    last_accuracy = Column(Float, nullable=True)
    last_location_time = Column(DateTime, nullable=True)

    # Activity & Health
    last_sync_time = Column(DateTime, nullable=True)
    last_heartbeat = Column(DateTime, nullable=True, default=lambda: datetime.now(timezone.utc))
    status = Column(String, nullable=False, default="OFFLINE") # ONLINE, OFFLINE, UNREACHABLE
    permission_status = Column(Text, nullable=True, default="{}")
    tracking_mode = Column(String, nullable=False, default="NORMAL")
    is_tracking_enabled = Column(Boolean, nullable=False, default=True)

    # Emergency Lost Mode
    is_lost_mode = Column(Boolean, nullable=False, default=False)
    lost_mode_message = Column(String, nullable=True, default="This device is reported lost. Please contact the owner.")

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    owner = relationship("User", back_populates="devices")
    locations = relationship("Location", back_populates="device", cascade="all, delete-orphan")
    commands = relationship("Command", back_populates="device", cascade="all, delete-orphan")
    snapshots = relationship("Snapshot", back_populates="device", cascade="all, delete-orphan")
