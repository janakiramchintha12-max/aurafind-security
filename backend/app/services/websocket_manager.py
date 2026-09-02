import json
from typing import Dict, List
from fastapi import WebSocket

class ConnectionManager:
    def __init__(self):
        # Map user_id -> List of WebSockets (Web dashboard clients)
        self.active_user_connections: Dict[str, List[WebSocket]] = {}
        # Map device_id -> WebSocket (Android device clients)
        self.active_device_connections: Dict[str, WebSocket] = {}

    async def connect_user(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        if user_id not in self.active_user_connections:
            self.active_user_connections[user_id] = []
        self.active_user_connections[user_id].append(websocket)

    def disconnect_user(self, websocket: WebSocket, user_id: str):
        if user_id in self.active_user_connections:
            if websocket in self.active_user_connections[user_id]:
                self.active_user_connections[user_id].remove(websocket)
            if not self.active_user_connections[user_id]:
                del self.active_user_connections[user_id]

    async def connect_device(self, websocket: WebSocket, device_id: str):
        await websocket.accept()
        self.active_device_connections[device_id] = websocket

    def disconnect_device(self, device_id: str):
        if device_id in self.active_device_connections:
            del self.active_device_connections[device_id]

    async def send_to_user(self, user_id: str, message: dict):
        if user_id in self.active_user_connections:
            disconnected = []
            for ws in self.active_user_connections[user_id]:
                try:
                    await ws.send_text(json.dumps(message))
                except Exception:
                    disconnected.append(ws)
            for ws in disconnected:
                self.disconnect_user(ws, user_id)

    async def send_command_to_device(self, device_id: str, command_data: dict) -> bool:
        if device_id in self.active_device_connections:
            try:
                ws = self.active_device_connections[device_id]
                await ws.send_text(json.dumps(command_data))
                return True
            except Exception:
                self.disconnect_device(device_id)
                return False
        return False

manager = ConnectionManager()
