from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, Query, status
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.database.session import engine, Base
from app.api.v1.endpoints import auth, devices, locations, commands, geofences, audit, snapshots, camera
from app.services.websocket_manager import manager
from app.core.security import decode_token

# Initialize Database tables
Base.metadata.create_all(bind=engine)

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
