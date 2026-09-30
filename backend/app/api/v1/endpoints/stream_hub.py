import asyncio
import logging
from typing import Dict, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, status
from app.database.session import SessionLocal
from app.models.device import Device
from app.core.security import decode_token

logger = logging.getLogger("aurafind.stream_hub")
router = APIRouter()

# Binary Packet Header (10 bytes):
# Byte 0:   Packet type  (0x01=H.264, 0x02=PCM audio, 0x03=control, 0x04=dashboard->device audio)
# Byte 1:   Source       (0x01=screen, 0x02=front-cam, 0x03=back-cam, 0x04=mic)
# Bytes 2-9: uint64 big-endian microseconds timestamp
# Bytes 10+: Payload (H.264 Annex-B NAL units or PCM16 @ 48kHz)


class StreamHub:
    """
    In-process zero-copy binary WebSocket relay.
    KEY OPTIMIZATIONS:
    - Per-viewer asyncio.Queue(maxsize=2): drops OLDEST frames when viewer is slow,
      so viewer always shows the LATEST frame (eliminates latency accumulation).
    - Keyframe cache: new viewers get video immediately on connect, no 2s wait.
    - Viewer send loop runs as independent asyncio.Task, decoupled from receive loop.
    - No sequential await loops in broadcast path.
    """

    def __init__(self):
        self.device_streamers: Dict[str, WebSocket] = {}
        self.device_viewer_queues: Dict[str, Set[asyncio.Queue]] = {}
        self.latest_keyframe: Dict[str, bytes] = {}

    async def register_streamer(self, websocket: WebSocket, device_id: str):
        await websocket.accept()
        old = self.device_streamers.get(device_id)
        if old and old is not websocket:
            try:
                await old.close(code=status.WS_1000_NORMAL_CLOSURE)
            except Exception:
                pass
        self.device_streamers[device_id] = websocket
        logger.info(f"[StreamHub] Streamer connected: {device_id}")

    def unregister_streamer(self, device_id: str, websocket: WebSocket):
        if self.device_streamers.get(device_id) is websocket:
            del self.device_streamers[device_id]
            logger.info(f"[StreamHub] Streamer disconnected: {device_id}")

    async def register_viewer(self, websocket: WebSocket, user_id: str, device_id: str) -> asyncio.Queue:
        await websocket.accept()
        q: asyncio.Queue = asyncio.Queue(maxsize=2)
        self.device_viewer_queues.setdefault(device_id, set()).add(q)
        logger.info(f"[StreamHub] Viewer connected: device={device_id} user={user_id}")
        for source_key in [f"{device_id}:01", f"{device_id}:02", f"{device_id}:03"]:
            cached = self.latest_keyframe.get(source_key)
            if cached:
                try:
                    await websocket.send_bytes(cached)
                except Exception:
                    pass
        return q

    def unregister_viewer_queue(self, device_id: str, q: asyncio.Queue):
        queues = self.device_viewer_queues.get(device_id)
        if queues:
            queues.discard(q)
            if not queues:
                del self.device_viewer_queues[device_id]

    def _update_keyframe_cache(self, device_id: str, data: bytes):
        if len(data) < 14:
            return
        pkt_type = data[0]
        source = data[1]
        if pkt_type != 0x01:
            return
        payload = data[10:]
        for i in range(min(len(payload) - 4, 64)):
            if payload[i] == 0 and payload[i + 1] == 0:
                nal_byte = None
                if payload[i + 2] == 1:
                    nal_byte = payload[i + 3]
                elif payload[i + 2] == 0 and payload[i + 3] == 1 and i + 4 < len(payload):
                    nal_byte = payload[i + 4]
                if nal_byte is not None and (nal_byte & 0x1F) in (5, 7):
                    self.latest_keyframe[f"{device_id}:{source:02x}"] = data
                    return

    async def broadcast_device_binary(self, device_id: str, data: bytes):
        self._update_keyframe_cache(device_id, data)
        queues = self.device_viewer_queues.get(device_id)
        if not queues:
            return
        for q in list(queues):
            if q.full():
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                q.put_nowait(data)
            except asyncio.QueueFull:
                pass

    async def send_to_device(self, device_id: str, data: bytes):
        streamer = self.device_streamers.get(device_id)
        if streamer:
            try:
                await streamer.send_bytes(data)
            except Exception:
                self.unregister_streamer(device_id, streamer)


stream_hub = StreamHub()


@router.websocket("/stream/ws")
@router.websocket("//stream/ws")
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
            db.close()
            await stream_hub.register_streamer(websocket, device_id)
            try:
                while True:
                    msg = await websocket.receive()
                    raw = msg.get("bytes")
                    text = msg.get("text")
                    if raw:
                        await stream_hub.broadcast_device_binary(device_id, raw)
                    elif text == "ping":
                        await websocket.send_text("pong")
            except WebSocketDisconnect:
                stream_hub.unregister_streamer(device_id, websocket)

        elif token and target_device_id:
            from app.models.user import User
            payload = decode_token(token)
            if not payload or payload.get("type") != "access":
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return
            user_id = payload.get("sub")
            user = db.query(User).filter(User.id == user_id).first()
            if not user:
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return
            ADMIN_ACCOUNTS = {"founder@theft.in", "janakiram12", "admin"}
            is_admin = user.email in ADMIN_ACCOUNTS or user.id in {"founder-ceo-uuid", "janakiram12-user-uuid", "default-admin-uuid"}
            if is_admin:
                device = db.query(Device).filter(
                    Device.id == target_device_id,
                    Device.enrollment_status != "REVOKED"
                ).first()
            else:
                device = db.query(Device).filter(
                    Device.id == target_device_id,
                    Device.user_id == user_id,
                    Device.enrollment_status != "REVOKED"
                ).first()
            if not device:
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return
            db.close()

            viewer_queue = await stream_hub.register_viewer(websocket, user_id, target_device_id)

            async def send_frames():
                try:
                    while True:
                        frame = await viewer_queue.get()
                        await websocket.send_bytes(frame)
                except Exception:
                    pass

            send_task = asyncio.create_task(send_frames())
            try:
                while True:
                    msg = await websocket.receive()
                    raw = msg.get("bytes")
                    text = msg.get("text")
                    if raw:
                        await stream_hub.send_to_device(target_device_id, raw)
                    elif text == "ping":
                        await websocket.send_text("pong")
            except WebSocketDisconnect:
                pass
            finally:
                send_task.cancel()
                stream_hub.unregister_viewer_queue(target_device_id, viewer_queue)
        else:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
    finally:
        try:
            db.close()
        except Exception:
            pass
