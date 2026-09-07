from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, Integer, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.database.session import Base
import uuid

class VideoRecording(Base):
    __tablename__ = "video_recordings"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    device_id = Column(String, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    
    video_data = Column(Text, nullable=False) # Base64 encoded video (video/mp4)
    thumbnail_data = Column(Text, nullable=True) # Base64 encoded JPEG thumbnail
    mime_type = Column(String, nullable=False, default="video/mp4")
    duration_seconds = Column(Float, nullable=False, default=10.0)
    facing = Column(String, nullable=False, default="FRONT") # FRONT or BACK
    file_size_bytes = Column(Integer, nullable=True, default=0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
