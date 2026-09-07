import os
import json
from typing import List, Union
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator

class Settings(BaseSettings):
    PROJECT_NAME: str = "AuraFind Security Platform"
    API_V1_STR: str = "/api/v1"
    
    # Environment & Debug
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development").lower()
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"
    ENABLE_DEV_SEEDS: bool = os.getenv("ENABLE_DEV_SEEDS", "true" if os.getenv("ENVIRONMENT", "development").lower() == "development" else "false").lower() == "true"
    ENABLE_API_DOCS: bool = os.getenv("ENABLE_API_DOCS", "true" if os.getenv("ENVIRONMENT", "development").lower() != "production" else "false").lower() == "true"

    # Cryptography & Auth
    SECRET_KEY: str = os.getenv("SECRET_KEY", "super-secret-key-change-in-production-32bytes-min!")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 1 day
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    
    # Database
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", 
        "sqlite:////tmp/findmydevice.db" if os.getenv("VERCEL") or os.getenv("AWS_LAMBDA_FUNCTION_NAME") else "sqlite:///./findmydevice.db"
    )

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def assemble_db_url(cls, v: str) -> str:
        if isinstance(v, str) and v.startswith("postgres://"):
            return v.replace("postgres://", "postgresql://", 1)
        return v
    
    # CORS
    BACKEND_CORS_ORIGINS: Union[List[str], str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "https://aurafind.onrender.com",
        "https://theft.in",
        "https://aurafind.vercel.app"
    ]

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",") if i.strip()]
        elif isinstance(v, str) and v.startswith("["):
            try:
                return json.loads(v)
            except Exception:
                pass
        elif isinstance(v, (list, tuple)):
            return list(v)
        return [
            "http://localhost:5173",
            "http://localhost:3000",
            "http://127.0.0.1:5173"
        ]

    model_config = SettingsConfigDict(case_sensitive=True, env_file=".env", extra="ignore")

settings = Settings()

# Production Security Check
if settings.ENVIRONMENT == "production":
    if settings.SECRET_KEY == "super-secret-key-change-in-production-32bytes-min!" or len(settings.SECRET_KEY) < 32:
        import warnings
        warnings.warn("CRITICAL SECURITY WARNING: Production SECRET_KEY is using default placeholder or is under 32 bytes! Set SECRET_KEY in environment variables.", UserWarning)

