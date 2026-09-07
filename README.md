# AuraFind - Multi-Device Personal Mobile Security Platform

A production-grade, multi-device personal mobile security and Find My Device platform built from scratch. Supports registering and managing **3-4+ user-owned Android devices** from a central web dashboard, complete with offline location queueing, real-time WebSocket telemetry, geofencing, remote alarm triggers, security audit logging, and adaptive battery optimization.

---

## 🌟 Key Capabilities

- 🛡️ **Device-Controlled Privacy & Consent Center**: Handset user retains authoritative, non-overrideable control over Camera, Microphone, GPS Telemetry, Loudspeaker, and Remote Lock. Covert access is strictly blocked (`403 Forbidden`) with immutable audit trails.
- 📱 **Multi-Device Account Platform**: Manage up to 4+ Android devices under one account with device credential isolation.
- 📡 **Offline Location Engine & Airplane Mode Queueing**: Stores location fixes locally in Room Database when disconnected or in Airplane Mode, auto-synchronizing in chronological batches when connectivity returns.
- 🚨 **Remote Tactical Command Center**: Dispatch authenticated commands (`LOCATE_NOW`, `PLAY_ALARM`, `START_CAMERA_STREAM`, `START_VOICE_CALL`, `CAPTURE_SNAPSHOT`, `ENABLE_LOST_MODE`, `SPEAK_TEXT`) with real-time feedback.
- 🗺️ **Interactive Web Dashboard**: React + TypeScript + Leaflet map view with route history polylines, date range filters, live camera streaming, two-way VoIP intercom, and forensic police dossier generator.
- 🔒 **Security Auditing & Privacy**: JWT authentication, bcrypt hashing, IDOR ownership verification, and cryptographic append-only audit log stream.

---

## 📁 Repository Structure

```
c:\Users\janak\Desktop\theft.in\
├── backend/                  # Python FastAPI Backend API & Pytest Suite
│   ├── app/                  # API endpoints, DB models, schemas, services
│   ├── tests/                # Test suite for Auth, Devices, Locations, Commands & Privacy
│   ├── Dockerfile
│   └── requirements.txt
├── dashboard/                # React 18 + TypeScript + Tailwind Web Dashboard
│   ├── src/                  # Components, Pages, Services, Modals, Map UI
│   ├── Dockerfile
│   └── package.json
├── android/                  # Android Kotlin App (Jetpack Compose + Room + WorkManager)
│   ├── app/src/main/         # PrivacyManager, SecurityPrivacyScreen, LocationService
│   └── build.gradle.kts
├── docs/                     # Documentation & Verification
│   ├── PRIVACY_ARCHITECTURE.md # Device-Controlled Privacy & Consent Architecture
│   ├── SECURITY.md           # Security Safeguards & Policies
│   ├── THREAT_MODEL.md       # Threat Model & Adversarial Analysis
│   ├── INSTALLATION.md       # Setup & Execution Guide
│   ├── ARCHITECTURE.md       # System Architecture & Technical Specifications
│   └── VERIFICATION.md       # Feature & 20-Scenario Failure Test Matrix
├── docker-compose.yml        # Docker Multi-Service Orchestration
├── .env.example              # Environment Variable Template
└── README.md
```

---

## 🚀 Quick Start

### 1. Run Backend (FastAPI)
```bash
cd backend
pip install -r requirements.txt
pytest tests/
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. Run Dashboard (React)
```bash
cd dashboard
npm install
npm run build
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## 📄 Documentation

- [Device-Controlled Privacy & Consent Architecture](docs/PRIVACY_ARCHITECTURE.md)
- [Security Safeguards & Policy](docs/SECURITY.md)
- [Threat Model & Adversarial Analysis](docs/THREAT_MODEL.md)
- [Installation & Setup Guide](docs/INSTALLATION.md)
- [System Architecture](docs/ARCHITECTURE.md)
- [Verification Report & Failure Scenarios Matrix](docs/VERIFICATION.md)
