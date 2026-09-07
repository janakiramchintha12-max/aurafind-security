from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.database.session import Base
import uuid

class AudioRecording(Base):
    __tablename__ = "audio_recordings"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    device_id = Column(String, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    
    audio_data = Column(Text, nullable=False) # Base64 encoded audio (audio/mp4 or audio/wav)
    mime_type = Column(String, nullable=False, default="audio/mp4")
    duration_seconds = Column(Float, nullable=False, default=10.0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
