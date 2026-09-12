import asyncio
import struct
import logging
from typing import Dict, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, status
from app.database.session import SessionLocal
from app.models.device import Device
from app.models.user import User
from app.core.security import decode_token

logger = logging.getLogger("aurafind.stream_hub")
router = APIRouter()

# Packet Header Structure (10 bytes):
# Byte 0: Packet Type (0x01 = H.264 Video Frame, 0x02 = PCM Audio Chunk, 0x03 = Stream Control / Metadata, 0x04 = Dashboard Audio to Device)
# Byte 1: Stream Source (0x01 = Screen Mirror, 0x02 = Front Camera, 0x03 = Rear Camera, 0x04 = Microphone)
# Bytes 2-9: 64-bit Big-Endian Microsecond Timestamp (uint64)
# Bytes 10+: Payload (H.264 NAL units or 16-bit PCM audio)

class StreamHub:
    def __init__(self):
        self.device_viewers: Dict[str, Set[WebSocket]] = {}
        self.device_streamers: Dict[str, WebSocket] = {}
        self.viewer_meta: Dict[WebSocket, tuple] = {}
        self.latest_keyframe_header: Dict[str, bytes] = {}

    async def register_streamer(self, websocket: WebSocket, device_id: str):
        await websocket.accept()
        old_ws = self.device_streamers.get(device_id)
        if old_ws and old_ws != websocket:
            try:
                await old_ws.close(code=status.WS_1000_NORMAL_CLOSURE)
            except Exception:
                pass
        self.device_streamers[device_id] = websocket
        logger.info(f"[StreamHub] Device streamer connected: {device_id}")

    def unregister_streamer(self, device_id: str, websocket: WebSocket):
        if self.device_streamers.get(device_id) == websocket:
            del self.device_streamers[device_id]
            logger.info(f"[StreamHub] Device streamer disconnected: {device_id}")

    async def register_viewer(self, websocket: WebSocket, user_id: str, device_id: str):
        await websocket.accept()
        if device_id not in self.device_viewers:
            self.device_viewers[device_id] = set()
        self.device_viewers[device_id].add(websocket)
        self.viewer_meta[websocket] = (user_id, device_id)
        logger.info(f"[StreamHub] Dashboard viewer connected for device: {device_id} (User: {user_id})")

        # Send cached keyframe config if available for zero-delay video initialization
        for source_key in [f"{device_id}:01", f"{device_id}:02", f"{device_id}:03"]:
            cached_hdr = self.latest_keyframe_header.get(source_key)
            if cached_hdr:
                try:
                    await websocket.send_bytes(cached_hdr)
                except Exception:
                    pass

    def unregister_viewer(self, websocket: WebSocket):
        meta = self.viewer_meta.pop(websocket, None)
        if meta:
            user_id, device_id = meta
            if device_id in self.device_viewers:
                self.device_viewers[device_id].discard(websocket)
                if not self.device_viewers[device_id]:
                    del self.device_viewers[device_id]
            logger.info(f"[StreamHub] Dashboard viewer disconnected for device: {device_id}")

    async def broadcast_device_binary(self, device_id: str, data: bytes):
        if len(data) >= 10:
            pkt_type = data[0]
            source = data[1]
            if pkt_type == 0x01:
                self.latest_keyframe_header[f"{device_id}:{source:02x}"] = data

        viewers = self.device_viewers.get(device_id)
        if viewers:
            disconnected = []
            for ws in list(viewers):
                try:
                    await ws.send_bytes(data)
                except Exception:
                    disconnected.append(ws)
            for ws in disconnected:
                self.unregister_viewer(ws)

    async def send_to_device(self, device_id: str, data: bytes):
        streamer = self.device_streamers.get(device_id)
        if streamer:
            try:
                await streamer.send_bytes(data)
            except Exception:
                self.unregister_streamer(device_id, streamer)

stream_hub = StreamHub()

@router.websocket("/stream/ws")
async def binary_stream_websocket(
    websocket: WebSocket,
    token: str = Query(None),
    device_token: str = Query(None),
    device_id: str = Query(None),
    target_device_id: str = Query(None)
):
    db = SessionLocal()
    try:
        if device_token and device_id:
            device = db.query(Device).filter(
                Device.id == device_id,
                Device.device_token == device_token,
                Device.enrollment_status != "REVOKED"
            ).first()
            if not device:
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            await stream_hub.register_streamer(websocket, device_id)
            try:
                while True:
                    data = await websocket.receive_bytes()
                    if data:
                        await stream_hub.broadcast_device_binary(device_id, data)
            except WebSocketDisconnect:
                stream_hub.unregister_streamer(device_id, websocket)

        elif token and target_device_id:
            payload = decode_token(token)
            if not payload or payload.get("type") != "access":
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return
            user_id = payload.get("sub")
            device = db.query(Device).filter(
                Device.id == target_device_id,
                Device.user_id == user_id,
                Device.enrollment_status != "REVOKED"
            ).first()
            if not device:
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            await stream_hub.register_viewer(websocket, user_id, target_device_id)
            try:
                while True:
                    data = await websocket.receive_bytes()
                    if data:
                        await stream_hub.send_to_device(target_device_id, data)
            except WebSocketDisconnect:
                stream_hub.unregister_viewer(websocket)
        else:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
    finally:
        db.close()
