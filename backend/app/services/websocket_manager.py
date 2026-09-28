import asyncio
import json
from typing import Dict, List
from fastapi import WebSocket


class ConnectionManager:
    """
    Zero-latency WebSocket fan-out hub.
    KEY OPTIMIZATIONS:
    - asyncio.gather() for concurrent broadcast: all dashboard clients receive
      messages simultaneously, not sequentially.
    - Disconnected clients removed lazily outside the hot broadcast path.
    - Separate binary broadcast method for H.264/PCM frames (no JSON overhead).
    """

    def __init__(self):
        self.active_user_connections: Dict[str, List[WebSocket]] = {}
        self.active_device_connections: Dict[str, WebSocket] = {}

    async def connect_user(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        self.active_user_connections.setdefault(user_id, []).append(websocket)

    def disconnect_user(self, websocket: WebSocket, user_id: str):
        conns = self.active_user_connections.get(user_id, [])
        if websocket in conns:
            conns.remove(websocket)
        if not conns:
            self.active_user_connections.pop(user_id, None)

    async def connect_device(self, websocket: WebSocket, device_id: str):
        await websocket.accept()
        self.active_device_connections[device_id] = websocket

    def disconnect_device(self, device_id: str):
        self.active_device_connections.pop(device_id, None)

    async def send_to_user(self, user_id: str, message: dict):
        """Concurrent JSON broadcast to all dashboard clients for this user."""
        conns = self.active_user_connections.get(user_id)
        if not conns:
            return
        payload = json.dumps(message)
        results = await asyncio.gather(
            *[ws.send_text(payload) for ws in list(conns)],
            return_exceptions=True
        )
        disconnected = [conns[i] for i, r in enumerate(results) if isinstance(r, Exception)]
        for ws in disconnected:
            self.disconnect_user(ws, user_id)

    async def broadcast_binary_to_user(self, user_id: str, data: bytes):
        """Concurrent binary frame broadcast (H.264/PCM) with zero JSON overhead."""
        conns = self.active_user_connections.get(user_id)
        if not conns:
            return
        results = await asyncio.gather(
            *[ws.send_bytes(data) for ws in list(conns)],
            return_exceptions=True
        )
        disconnected = [conns[i] for i, r in enumerate(results) if isinstance(r, Exception)]
        for ws in disconnected:
            self.disconnect_user(ws, user_id)

    async def send_command_to_device(self, device_id: str, command_data: dict) -> bool:
        ws = self.active_device_connections.get(device_id)
        if ws:
            try:
                await ws.send_text(json.dumps(command_data))
                return True
            except Exception:
                self.disconnect_device(device_id)
        return False


manager = ConnectionManager()
