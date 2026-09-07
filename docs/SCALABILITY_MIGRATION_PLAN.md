# AuraFind Security — Scalability & Architecture Migration Plan

**Document Version**: 1.0.0  
**Target Horizon**: Pilot (Current) → Enterprise Fleet Scaling (1,000,000+ Enrolled Endpoints)  
**Status**: Architecture Blueprint & Engineering Roadmap

---

## 1. Executive Summary

The **AuraFind Security Platform** currently operates in **Controlled Pilot Mode** utilizing a lightweight single-node architecture (FastAPI + SQLite + In-Memory WebSocket Manager + In-Memory Rate Limiting). While optimal for localized validation, zero-cost staging, and low-complexity pilot deployments, scaling to an enterprise multi-tenant fleet requires a structured, zero-downtime architecture migration.

This document details the multi-phase engineering plan to evolve AuraFind into a horizontally scalable, cloud-native enterprise security platform.

```
+-----------------------------------------------------------------------------------+
|                        AURAFIND ENTERPRISE EVOLUTION                              |
|                                                                                   |
|  [Phase 1: Pilot]         [Phase 2: RDBMS Tier]        [Phase 3: Distributed]     |
|   FastAPI + SQLite  --->   PostgreSQL + PostGIS  --->   Redis Cluster Pub/Sub     |
|   In-Memory WS             PgBouncer Pooling            Distributed Rate Limiting |
|   Single Node              Partitioned Telemetry        Multi-Node WebSockets     |
|                                                                                   |
|  [Phase 4: Forensics Object Store]         [Phase 5: High-Throughput Stream]      |
|   S3 / Cloudflare R2 + Presigned URLs --->  Kafka Event Queue + TimescaleDB       |
|   WebRTC SFU (LiveKit/Coturn) Media         100,000+ GPS Pings/sec Ingestion      |
+-----------------------------------------------------------------------------------+
```

---

## 2. Current Architecture Baseline & Pilot Limitations

| Subsystem | Current Pilot Implementation | Pilot Capacity Ceiling | Enterprise Production Limitation |
| :--- | :--- | :--- | :--- |
| **Database Engine** | SQLite (`findmydevice.db`) | ~10-50 active devices | Table-level write locking causes lock contention under high-frequency location syncs. Ephemeral container filesystems reset state on redeploy. |
| **Connection Pooling** | SQLAlchemy default pool | 5-10 concurrent workers | Lack of external transaction pooling (PgBouncer) causes database connection exhaustion under burst traffic. |
| **Rate Limiting** | Sliding-window in-memory dict | Single FastAPI process | Limits are isolated per process/container; traffic routed across multiple load-balanced instances bypasses limits. |
| **Real-Time WebSockets**| In-memory `ConnectionManager` | Single server process | WebSockets connected to Server A cannot broadcast `DEVICE_PRIVACY_STATE_UPDATE` to dashboards connected to Server B. |
| **Media / Snapshots** | Base64 strings in database | ~1,000 snapshots | Snapshot images stored in SQL rows bloat database backups and memory cache; degrades query throughput. |
| **Geospatial Processing** | Python Haversine formula | Simple circular geofences | Computations performed in Python process memory rather than hardware-accelerated spatial database indexes. |

---

## 3. Phase 2: Relational Database Migration (PostgreSQL + PostGIS)

### 3.1 Migration Specifications
- **Target RDBMS**: Managed PostgreSQL 16+ (Amazon RDS / Aurora / Neon / Render Managed PostgreSQL).
- **Spatial Engine**: `PostGIS 3.4+` extension for hardware-accelerated R-Tree spatial indexing (`GIST`).
- **Connection Pooler**: `PgBouncer` configured in Transaction Pooling mode (Max 2,000 pool clients, 50 backend server connections).

### 3.2 Automated Database Migration (Alembic)
1. Export current SQLite schema and seed definitions to Alembic version scripts:
   ```bash
   alembic revision --autogenerate -m "enterprise_postgresql_init"
   alembic upgrade head
   ```
2. Enable spatial columns for geofencing:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   ALTER TABLE geofences ADD COLUMN geom geometry(Polygon, 4326);
   CREATE INDEX idx_geofences_geom ON geofences USING GIST(geom);
   ```
3. Table Partitioning Strategy for Telemetry:
   Partition `location_history` by range on `timestamp` (Monthly Partitions) to maintain sub-millisecond query performance over hundreds of millions of GPS records.

---

## 4. Phase 3: Distributed State & Real-Time Coordination (Redis Cluster)

### 4.1 Redis Cluster Architecture
- **Engine**: Redis 7.2+ Cluster with Sentinel automatic failover.
- **Roles**:
  1. **Distributed Sliding-Window Rate Limiting**: Implemented via Redis Sorted Sets (`ZADD`, `ZREMRANGEBYSCORE`, `ZCARD`) executing atomically in Lua scripts.
  2. **WebSocket Cross-Node Backplane**: Redis Pub/Sub channels (`channel:user:{user_id}`, `channel:device:{device_id}`) enabling seamless real-time message fan-out across any number of backend replicas.
  3. **Ephemeral Token & Nonce Vault**: 5-minute challenge nonces stored with atomic `SET key value EX 300 NX` (Burn-on-Read).

```
[Android Handset] <--> [FastAPI Node 1] \
                                          --> [Redis Pub/Sub Backplane] <--> [FastAPI Node 2] <--> [Web Dashboard]
[Admin Dashboard] <--> [FastAPI Node 3] /
```

---

## 5. Phase 4: Object Storage & WebRTC Media Tier

### 5.1 Tamper-Evident Forensic Evidence Object Store
- **Provider**: AWS S3 / Cloudflare R2 Object Storage with Object Lock (WORM - Write Once, Read Many).
- **Architecture**:
  - Android captures intruder photo or surveillance snapshot.
  - Handset requests secure presigned PUT URL from FastAPI.
  - Image uploaded directly to Object Store with SHA-256 integrity digest stored in PostgreSQL audit log.
  - Web dashboard views snapshot via time-limited presigned GET URL (15-minute expiration).

### 5.2 Ultra-Low Latency Video & VoIP Streaming
- **Protocol**: WebSockets fallback → WebRTC Peer-to-Peer with LiveKit / Coturn TURN/STUN infrastructure.
- **Throughput**: Hardware-accelerated H.264 / VP8 hardware encoder achieving 120 FPS at <150ms glass-to-glass latency across cellular networks.

---

## 6. Phase 5: High-Throughput Telemetry Event Queue (Kafka / Event Ingestion)

```
[1,000,000 Android Devices]
              |
      (HTTP POST / Batch)
              v
     [Ingestion API Fleet]
              |
       (Publish Event)
              v
   [Apache Kafka Event Bus]  <--- (Partitioned by Device ID)
              |
    +---------+---------+
    |                   |
    v                   v
[Stream Processor]  [Batch DB Ingest Worker]
(Geofence Alerts)   (Writes to TimescaleDB)
```

---

## 7. Disaster Recovery & Backup SLA

| Metric | Target SLA | Strategy |
| :--- | :--- | :--- |
| **RPO (Recovery Point Objective)** | < 5 Minutes | Continuous PostgreSQL WAL archiving to S3 + multi-AZ replication |
| **RTO (Recovery Time Objective)** | < 15 Minutes | Automated container spin-up with infrastructure-as-code (Terraform) |
| **Backup Retention** | 30 Days | Daily automated snapshots + Point-in-Time Recovery (PITR) |
| **Failover Health Check** | Automated (<30s) | Route 53 / Cloudflare DNS health probe switching |

---

## 8. Migration Phase Execution Roadmap

| Milestone | Target Environment | Key Deliverables | Validation Criteria |
| :--- | :--- | :--- | :--- |
| **Milestone 1 (Current)** | Controlled Pilot | Single-node Docker + SQLite + KeyStore ECDSA + PrivacyManager | 22/22 Tests Pass; Pilot Device Verification |
| **Milestone 2** | Staging Cloud | Managed PostgreSQL + Alembic Migrations + PostGIS | 10,000 Synthesized Fleet Load Test Pass |
| **Milestone 3** | Multi-Region Staging | Redis Cluster + Distributed Rate Limiter + Multi-Node WS | Cross-Node WebSocket Fan-Out Verified |
| **Milestone 4** | Production Cloud | AWS S3 Object Storage + WebRTC SFU + Production WAF | Penetration Test & SOC2 Compliance Gate |
