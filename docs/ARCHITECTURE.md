# AuraFind Mobile Security & Find My Device Architecture

## Technical Blueprint

```
+-----------------------------------------------------------------------------------+
|                                  WEB DASHBOARD                                    |
|                      (React 18 + TypeScript + Tailwind CSS)                       |
|   - Multi-Device Overview Grid      - Live WebSocket Telemetry Stream            |
|   - Leaflet Map (History / Live)    - Geofence Manager & Audit Logs               |
+------------------------------------------+----------------------------------------+
                                           |
                                           | HTTP REST / WebSockets
                                           v
+-----------------------------------------------------------------------------------+
|                                  FASTAPI BACKEND                                  |
|                           (Python 3.12 + SQLAlchemy 2.0)                          |
|   - Auth Engine (JWT + Bcrypt)      - Device Registry & Ownership Guard         |
|   - Batch Location Ingestion Engine - Geofence Haversine Boundary Engine          |
|   - WebSocket Connection Manager    - Audit Trail Logger                          |
+------------------------------------------+----------------------------------------+
                                           |
                                           | Database Engine
                                           v
+-----------------------------------------------------------------------------------+
|                                DATABASE STORAGE                                   |
|                      (SQLite Development / PostgreSQL Production)                 |
+-----------------------------------------------------------------------------------+

                                           ^
                                           | HTTP REST & Heartbeat
                                           |
+------------------------------------------+----------------------------------------+
|                                ANDROID CLIENT APP                                 |
|                         (Kotlin + Jetpack Compose + Room DB)                      |
|   - LocationService (Foreground)    - FusedLocationProviderClient                 |
|   - Offline Queue (Room Database)   - WorkManager Automatic Sync              |
|   - Remote Command Execution        - AudioAlarmManager (Emergency Ring)          |
+-----------------------------------------------------------------------------------+
```

## Security & Permission Model

1. **Authorization Ownership Rule**: Every API request targeting a device requires `User Ownership Verification` (`user_id -> owns device_id -> operation`).
2. **Device Authentication**: Android clients authenticate using a unique secret `X-Device-Token` header generated upon device registration.
3. **No Exploits Policy**: Strictly uses official Android APIs (`FOREGROUND_SERVICE_LOCATION`, `AudioManager.STREAM_ALARM`, Notification Manager).
4. **Data Isolation**: User A can never query, locate, or send commands to User B's devices (tested with HTTP 403 Forbidden).
