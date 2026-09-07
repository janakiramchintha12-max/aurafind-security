import uuid
import time
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, Query, Request, Response, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.database.session import engine, Base
from app.api.v1.endpoints import auth, devices, locations, commands, geofences, audit, snapshots, camera, audio
from app.services.websocket_manager import manager
from app.core.security import decode_token

# Initialize Database tables
Base.metadata.create_all(bind=engine)

def seed_default_admin():
    from app.database.session import SessionLocal
    from app.models.user import User
    from app.models.device import Device
    from app.core.security import get_password_hash

    db = SessionLocal()
    try:
        # 1. Seed or Update Janakiram12 Account
        janaki_user = db.query(User).filter(User.email == "janakiram12").first()
        if not janaki_user:
            janaki_user = User(
                id="janakiram12-user-uuid",
                email="janakiram12",
                hashed_password=get_password_hash("Janakiram12"),
                full_name="Janaki Ram"
            )
            db.add(janaki_user)
            db.commit()
            db.refresh(janaki_user)
        else:
            janaki_user.hashed_password = get_password_hash("Janakiram12")
            db.commit()

        # Also support admin / 1234
        admin_user = db.query(User).filter(User.email == "admin").first()
        if not admin_user:
            admin_user = User(
                id="default-admin-uuid",
                email="admin",
                hashed_password=get_password_hash("1234"),
                full_name="Admin User"
            )
            db.add(admin_user)
            db.commit()

        # Ensure Target Device (Realme 13 5G) is pre-registered and linked to janakiram12
        realme_device_id = "19de15a1-d3fe-4ed2-9bb3-b4b5821bba3c"
        realme_dev = db.query(Device).filter(Device.id == realme_device_id).first()
        if not realme_dev:
            realme_dev = Device(
                id=realme_device_id,
                user_id=janaki_user.id,
                device_name="Realme 13 5G",
                device_model="Realme RMX5070",
                android_version="14.0",
                app_version="1.0.0",
                device_token="d4d93059-eb8a-4c24-afb7-4ad5770cf798",
                battery_pct=75.0,
                status="ONLINE"
            )
            db.add(realme_dev)
            db.commit()
        else:
            realme_dev.user_id = janaki_user.id
            db.commit()

        # PERMANENTLY PURGE "janaki edge 50 fusion" (bdca7649-e699-4d57-a59a-e80a4db9e1de)
        moto_devs = db.query(Device).filter(
            (Device.id == "bdca7649-e699-4d57-a59a-e80a4db9e1de") |
            (Device.device_name.ilike("%edge 50 fusion%")) |
            (Device.device_model.ilike("%edge 50 fusion%"))
        ).all()
        for d in moto_devs:
            db.delete(d)
        db.commit()

        # PERMANENTLY PURGE all location history and geofences
        from app.models.location import Location
        from app.models.geofence import Geofence
        db.query(Location).delete()
        db.query(Geofence).delete()
        db.commit()
    except Exception as e:
        logging.getLogger("aurafind.auth").warning(f"Development seed skipped: {e}")
    finally:
        db.close()

if settings.ENABLE_DEV_SEEDS:
    seed_default_admin()

# Configure API Documentation visibility
docs_url = "/docs" if settings.ENABLE_API_DOCS else None
redoc_url = "/redoc" if settings.ENABLE_API_DOCS else None
openapi_url = f"{settings.API_V1_STR}/openapi.json" if settings.ENABLE_API_DOCS else None

app = FastAPI(
    title=settings.PROJECT_NAME,
    docs_url=docs_url,
    redoc_url=redoc_url,
    openapi_url=openapi_url
)

# Security Headers & Correlation ID Middleware
@app.middleware("http")
async def security_headers_and_observability_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    start_time = time.time()

    response: Response = await call_next(request)

    process_time_ms = (time.time() - start_time) * 1000
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Process-Time-MS"] = f"{process_time_ms:.2f}"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "img-src 'self' data: blob: https:; "
        "script-src 'self' 'unsafe-inline' https:; "
        "style-src 'self' 'unsafe-inline' https:; "
        "connect-src 'self' https: wss: ws:; "
        "font-src 'self' data: https:; "
        "frame-ancestors 'none';"
    )

    if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

    return response

# Set up CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API Routers
app.include_router(auth.router, prefix=f"{settings.API_V1_STR}/auth", tags=["auth"])
app.include_router(devices.router, prefix=f"{settings.API_V1_STR}/devices", tags=["devices"])
app.include_router(locations.router, prefix=f"{settings.API_V1_STR}/devices", tags=["locations"])
app.include_router(commands.router, prefix=f"{settings.API_V1_STR}/devices", tags=["commands"])
app.include_router(snapshots.router, prefix=f"{settings.API_V1_STR}/devices", tags=["snapshots"])
app.include_router(camera.router, prefix=f"{settings.API_V1_STR}/devices", tags=["camera"])
app.include_router(audio.router, prefix=f"{settings.API_V1_STR}/devices", tags=["audio"])
app.include_router(geofences.router, prefix=f"{settings.API_V1_STR}/geofences", tags=["geofences"])
app.include_router(audit.router, prefix=f"{settings.API_V1_STR}/audit-logs", tags=["audit"])

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "project": settings.PROJECT_NAME,
        "environment": settings.ENVIRONMENT
    }

@app.get("/health/live")
def liveness_check():
    return {"status": "alive"}

@app.get("/health/ready")
def readiness_check():
    from app.database.session import SessionLocal
    from sqlalchemy import text
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ready", "database": "connected"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database connection unavailable"
        )
    finally:
        db.close()

@app.get("/download/app.apk")
def download_app_apk():
    import os
    possible_paths = [
        os.path.join(os.path.dirname(__file__), "..", "app-debug.apk"),
        os.path.join(os.path.dirname(__file__), "..", "..", "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk"),
        "/app/backend/app-debug.apk",
        os.path.abspath("backend/app-debug.apk"),
        os.path.abspath("app-debug.apk"),
        os.path.abspath("public/app-debug.apk")
    ]
    for p in possible_paths:
        if os.path.exists(p):
            return FileResponse(p, media_type="application/vnd.android.package-archive", filename="AuraFind-Security.apk")
    return {"error": "APK not found"}

@app.websocket("/api/v1/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(None),
    device_token: str = Query(None),
    device_id: str = Query(None)
):
    from app.database.session import SessionLocal
    from app.models.device import Device
    from app.models.user import User

    db = SessionLocal()
    try:
        if token:
            payload = decode_token(token)
            if not payload or payload.get("type") != "access":
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return
            user_id = payload.get("sub")
            user = db.query(User).filter(User.id == user_id).first()
            if not user:
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            await manager.connect_user(websocket, user_id)
            try:
                while True:
                    data = await websocket.receive_text()
                    if data == "ping":
                        await websocket.send_text("pong")
            except WebSocketDisconnect:
                manager.disconnect_user(websocket, user_id)

        elif device_token and device_id:
            device = db.query(Device).filter(
                Device.id == device_id,
                Device.device_token == device_token,
                Device.enrollment_status != "REVOKED"
            ).first()
            if not device:
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            await manager.connect_device(websocket, device_id)
            try:
                while True:
                    data = await websocket.receive_text()
                    if data == "ping":
                        await websocket.send_text("pong")
            except WebSocketDisconnect:
                manager.disconnect_device(device_id)
        else:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
    finally:
        db.close()

# Mount compiled React dashboard for 1-Click Cloud Deployment
import os
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

possible_dist_paths = [
    os.path.join(os.path.dirname(__file__), "..", "dashboard_dist"),
    os.path.join(os.path.dirname(__file__), "..", "..", "dashboard", "dist"),
    "/app/backend/dashboard_dist",
    "/app/dashboard/dist",
    os.path.abspath("dashboard_dist"),
    os.path.abspath("dashboard/dist")
]

dashboard_dist = None
for p in possible_dist_paths:
    if os.path.exists(p) and os.path.exists(os.path.join(p, "index.html")):
        dashboard_dist = p
        break

if dashboard_dist:
    assets_path = os.path.join(dashboard_dist, "assets")
    if os.path.exists(assets_path):
        app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

    @app.get("/")
    async def serve_spa_root():
        return FileResponse(os.path.join(dashboard_dist, "index.html"))

    @app.get("/{full_path:path}")
    async def serve_spa_frontend(full_path: str):
        file_path = os.path.join(dashboard_dist, full_path)
        if os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(dashboard_dist, "index.html"))
