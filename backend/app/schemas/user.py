from pydantic import BaseModel, ConfigDict, Field
from datetime import datetime
from typing import Optional

class UserCreate(BaseModel):
    email: str
    password: str = Field(min_length=10, max_length=128)
    full_name: Optional[str] = None

class UserLogin(BaseModel):
    email: str
    password: str = Field(min_length=1, max_length=128)

class UserResponse(BaseModel):
    id: str
    email: str
    full_name: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"

class TokenRefreshRequest(BaseModel):
    refresh_token: str

class TokenPayload(BaseModel):
    sub: Optional[str] = None
    type: Optional[str] = None

class UserChangePassword(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=10, max_length=128)
