from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, Query, status
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.database.session import engine, Base
from app.api.v1.endpoints import auth, devices, locations, commands, geofences, audit, snapshots, camera
from app.services.websocket_manager import manager
from app.core.security import decode_token

# Initialize Database tables and seed default admin
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

        # Ensure Janaki's phone is pre-registered and linked to janakiram12
        target_device_id = "bdca7649-e699-4d57-a59a-e80a4db9e1de"
        device = db.query(Device).filter(Device.id == target_device_id).first()
        if not device:
            device = Device(
                id=target_device_id,
                user_id=janaki_user.id,
                device_name="janaki edge 50 fusion",
                device_model="moto edge 50 fusion",
                android_version="14.0",
                app_version="1.0.0",
                device_token="ca65a717-1185-417b-b8fc-32289812d8eb",
                battery_pct=85.0,
                status="ONLINE"
            )
            db.add(device)
            db.commit()
        else:
            device.user_id = janaki_user.id
            db.commit()
    except Exception as e:
        print("Seed error:", e)
    finally:
        db.close()

seed_default_admin()

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json"
)

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
app.include_router(geofences.router, prefix=f"{settings.API_V1_STR}/geofences", tags=["geofences"])
app.include_router(audit.router, prefix=f"{settings.API_V1_STR}/audit-logs", tags=["audit"])

@app.get("/health")
def health_check():
    return {"status": "healthy", "project": settings.PROJECT_NAME}

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
    if token:
        payload = decode_token(token)
        if not payload or payload.get("type") != "access":
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        user_id = payload.get("sub")
        await manager.connect_user(websocket, user_id)
        try:
            while True:
                data = await websocket.receive_text()
                if data == "ping":
                    await websocket.send_text("pong")
        except WebSocketDisconnect:
            manager.disconnect_user(websocket, user_id)

    elif device_token and device_id:
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
