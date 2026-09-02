# AuraFind - Multi-Device Personal Mobile Security Platform

A production-grade, multi-device personal mobile security and Find My Device platform built from scratch. Supports registering and managing **3-4+ user-owned Android devices** from a central web dashboard, complete with offline location queueing, real-time WebSocket telemetry, geofencing, remote alarm triggers, security audit logging, and adaptive battery optimization.

---

## 🌟 Key Capabilities

- 📱 **Multi-Device Account Platform**: Manage up to 4+ Android devices (Main Phone, Backup Phone, Tablet, Spare Phone) under one account with device credential isolation.
- 📡 **Offline Location Engine & Airplane Mode Queueing**: Stores location fixes locally in Room Database when disconnected or in Airplane Mode, auto-synchronizing in chronological batches when connectivity returns.
- 🚨 **Remote Command Center**: Dispatch authenticated commands (`LOCATE_NOW`, `PLAY_ALARM`, `DISPLAY_MESSAGE`, `HIGH_ACCURACY_MODE`, `FORCE_SYNC`) with real-time feedback.
- 🗺️ **Interactive Web Dashboard**: React + TypeScript + Leaflet map view with route history polylines, date range filters (Today, Yesterday, 7d, 30d, Custom), and geofence circular safe zone configuration.
- 🔒 **Security Auditing & Privacy**: JWT authentication with refresh token rotation, bcrypt password hashing, IDOR ownership verification, and detailed security access logs.

---

## 📁 Repository Structure

```
c:\Users\janak\Desktop\theft.in\
├── backend/                  # Python FastAPI Backend API & Pytest Suite
│   ├── app/                  # API endpoints, DB models, schemas, services
│   ├── tests/                # Test suite for Auth, Devices, Locations & Commands
│   ├── Dockerfile
│   └── requirements.txt
├── dashboard/                # React 18 + TypeScript + Tailwind Web Dashboard
│   ├── src/                  # Components, Pages, Services, Map UI
│   ├── Dockerfile
│   └── package.json
├── android/                  # Android Kotlin App (Jetpack Compose + Room + WorkManager)
│   ├── app/src/main/         # LocationService, Room DAOs, Network Repository
│   └── build.gradle.kts
├── docs/                     # Documentation & Verification
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
python -m pytest tests/
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
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

- [Installation & Setup Guide](docs/INSTALLATION.md)
- [System Architecture](docs/ARCHITECTURE.md)
- [Verification Report & Failure Scenarios Matrix](docs/VERIFICATION.md)
