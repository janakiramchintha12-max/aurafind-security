import uuid
import time
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, Query, Request, Response, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.database.session import engine, Base
from app.api.v1.endpoints import auth, devices, locations, commands, geofences, audit, snapshots, camera, audio, video, screen, app_usage, stream_hub
from app.services.websocket_manager import manager
from app.core.security import decode_token

# Initialize Database tables
Base.metadata.create_all(bind=engine)

def init_fresh_platform_state():
    from app.database.session import SessionLocal
    from app.models.user import User
    from app.models.device import Device
    from app.models.snapshot import Snapshot
    from app.models.command import Command
    from app.models.audio_recording import AudioRecording
    from app.models.video_recording import VideoRecording
    from app.core.security import get_password_hash
    from datetime import datetime, timezone

    db = SessionLocal()
    try:
        # 1. Clear stale commands and temporary captures for clean start
        db.query(Snapshot).delete(synchronize_session=False)
        db.query(Command).delete(synchronize_session=False)
        db.query(AudioRecording).delete(synchronize_session=False)
        db.query(VideoRecording).delete(synchronize_session=False)

        # 2. Ensure only the single simple admin account exists with rotated ID (invalidates previous sessions)
        fresh_admin_id = f"admin-{uuid.uuid4().hex[:12]}"
        admin_user = db.query(User).filter(User.email == "admin").first()
        if not admin_user:
            admin_user = User(
                id=fresh_admin_id,
                email="admin",
                hashed_password=get_password_hash("admin"),
                full_name="Administrator"
            )
            db.add(admin_user)
            db.commit()
            db.refresh(admin_user)
        else:
            admin_user.hashed_password = get_password_hash("admin")
            admin_user.id = fresh_admin_id
            db.commit()

        # Seed and restore persistent registered devices from persistent devices_registry.json
        from app.services.registry_sync import load_registry_devices, REGISTRY_PATH
        if os.path.exists(REGISTRY_PATH):
            with open(REGISTRY_PATH, "r", encoding="utf-8") as f:
                try:
                    registry_devices = json.load(f)
                except Exception:
                    registry_devices = []
            if not registry_devices:
                # Factory reset state: clear all devices when registry is empty
                db.query(Device).delete(synchronize_session=False)
                db.commit()
            else:
                db.query(Device).update({Device.user_id: admin_user.id})
                db.commit()
                load_registry_devices(db, admin_user.id)

        # Remove all other accounts - keep strictly 1 active account
        db.query(User).filter(User.email != "admin").delete(synchronize_session=False)
        db.commit()
    except Exception as e:
        db.rollback()
        logging.getLogger("aurafind.init").warning(f"Platform init warning: {e}")
    finally:
        db.close()

init_fresh_platform_state()

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

from starlette.types import ASGIApp, Scope, Receive, Send

class NormalizeDoubleSlashMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] in ("http", "websocket"):
            path = scope.get("path", "")
            if "//" in path:
                while "//" in path:
                    path = path.replace("//", "/")
                scope["path"] = path
            raw_path = scope.get("raw_path")
            if raw_path and b"//" in raw_path:
                while b"//" in raw_path:
                    raw_path = raw_path.replace(b"//", b"/")
                scope["raw_path"] = raw_path
        await self.app(scope, receive, send)

app.add_middleware(NormalizeDoubleSlashMiddleware)

# Include API Routers
app.include_router(auth.router, prefix=f"{settings.API_V1_STR}/auth", tags=["auth"])
app.include_router(devices.router, prefix=f"{settings.API_V1_STR}/devices", tags=["devices"])
app.include_router(locations.router, prefix=f"{settings.API_V1_STR}/devices", tags=["locations"])
app.include_router(commands.router, prefix=f"{settings.API_V1_STR}/devices", tags=["commands"])
app.include_router(snapshots.router, prefix=f"{settings.API_V1_STR}/devices", tags=["snapshots"])
app.include_router(camera.router, prefix=f"{settings.API_V1_STR}/devices", tags=["camera"])
app.include_router(audio.router, prefix=f"{settings.API_V1_STR}/devices", tags=["audio"])
app.include_router(video.router, prefix=f"{settings.API_V1_STR}/devices", tags=["video"])
app.include_router(geofences.router, prefix=f"{settings.API_V1_STR}/geofences", tags=["geofences"])
app.include_router(audit.router, prefix=f"{settings.API_V1_STR}/audit-logs", tags=["audit"])
app.include_router(screen.router, prefix=f"{settings.API_V1_STR}/devices", tags=["screen"])
app.include_router(app_usage.router, prefix=f"{settings.API_V1_STR}/devices", tags=["app-usage"])
app.include_router(stream_hub.router, prefix=f"{settings.API_V1_STR}", tags=["stream-hub"])

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

    database_url = settings.DATABASE_URL.lower()
    database_backend = "postgresql" if database_url.startswith(("postgresql://", "postgres://")) else "sqlite"

    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        return {
            "status": "ready",
            "database": "connected",
            "database_backend": database_backend
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database connection unavailable: {str(e)}"
        )
    finally:
        db.close()

from fastapi.responses import HTMLResponse

@app.get("/download", response_class=HTMLResponse)
def mobile_download_landing_page(request: Request):
    host_url = str(request.base_url).rstrip("/")
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AuraFind - Download Mobile Security Client</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body {{ background: #0f172a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }}
    </style>
</head>
<body class="text-slate-100 min-h-screen flex flex-col items-center justify-center p-4">
    <div class="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
        <div class="text-center space-y-2">
            <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/30 mb-2">
                <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
                </svg>
            </div>
            <h1 class="text-2xl font-black text-white">AuraFind Security</h1>
            <p class="text-xs text-slate-400">Mobile Anti-Theft & Real-Time Handset Protection</p>
        </div>

        <div class="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-3">
            <div class="text-xs font-bold text-cyan-400 uppercase tracking-wider">Fast 3-Step Setup</div>
            <ol class="text-xs text-slate-300 space-y-2 list-decimal list-inside">
                <li><strong class="text-white">Download:</strong> Tap the big button below to download the APK.</li>
                <li><strong class="text-white">Install:</strong> Tap the downloaded file & choose "Install" (Allow unknown apps if prompted).</li>
                <li><strong class="text-white">Pair:</strong> Open app and tap "Auto-Pair" or "Scan QR" to link to your dashboard.</li>
            </ol>
        </div>

        <a href="/download/app.apk" download="AuraFind-Security.apk" class="w-full py-4 px-6 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-center rounded-2xl shadow-xl shadow-cyan-500/30 transition-all flex items-center justify-center space-x-3 text-sm">
            <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
            </svg>
            <span>Download APK Client (13 MB)</span>
        </a>

        <div class="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-[11px] text-emerald-300 leading-relaxed">
            🛡️ <strong>Silent Protection:</strong> AuraFind runs silently with minimized notifications and real-time GPS tracking.
        </div>

        <div class="text-center pt-2">
            <a href="/" class="text-xs text-slate-500 hover:text-slate-300 transition-colors">
                Open Web Dashboard &rarr;
            </a>
        </div>
    </div>
</body>
</html>"""

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
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="APK is not available")

@app.websocket("/api/v1/ws")
@app.websocket("//api/v1/ws")
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
            try:
                db.close()
            except Exception:
                pass

            await manager.connect_user(websocket, user_id)
            try:
                while True:
                    data = await websocket.receive_text()
                    if data == "ping":
                        await websocket.send_text("pong")
            except (WebSocketDisconnect, Exception):
                manager.disconnect_user(websocket, user_id)

        elif device_token and device_id:
            device = db.query(Device).filter(
                Device.id == device_id,
                Device.device_token == device_token,
                Device.enrollment_status != "REVOKED"
            ).first()
            if not device:
                existing_any = db.query(Device).filter(Device.id == device_id).first()
                if existing_any:
                    existing_any.device_token = device_token
                    device = existing_any
                    db.commit()
                else:
                    from app.models.user import User
                    admin_user = db.query(User).filter(User.email == "admin").first()
                    admin_id = admin_user.id if admin_user else "admin-user-uuid"
                    device = Device(
                        id=device_id,
                        user_id=admin_id,
                        device_token=device_token,
                        device_name=f"Android Device ({device_id[:6]})",
                        device_model="Android Handset",
                        status="ONLINE",
                        enrollment_status="ENROLLED",
                        last_heartbeat=datetime.now(timezone.utc)
                    )
                    db.add(device)
                    db.commit()
                    db.refresh(device)
            try:
                db.close()
            except Exception:
                pass

            await manager.connect_device(websocket, device_id)
            try:
                while True:
                    data = await websocket.receive_text()
                    if data == "ping":
                        await websocket.send_text("pong")
            except (WebSocketDisconnect, Exception):
                manager.disconnect_device(device_id)
        else:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
    finally:
        try:
            db.close()
        except Exception:
            pass

@app.websocket("//api/v1/stream/ws")
async def main_stream_ws_double_slash_alias(
    websocket: WebSocket,
    token: str = Query(None),
    device_token: str = Query(None),
    device_id: str = Query(None),
    target_device_id: str = Query(None)
):
    await stream_hub.binary_stream_websocket(
        websocket=websocket,
        token=token,
        device_token=device_token,
        device_id=device_id,
        target_device_id=target_device_id
    )

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
