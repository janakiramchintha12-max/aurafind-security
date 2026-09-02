# AuraFind Security Platform - Setup & Installation Guide

This document provides step-by-step instructions for installing, configuring, running, and testing the **AuraFind Multi-Device Personal Mobile Security Platform**.

---

## 1. Prerequisites & Required Software

| Software | Required Version | Verification Command |
|---|---|---|
| **Python** | 3.10+ (3.12 Recommended) | `python --version` |
| **Node.js** | v18+ (v24 Recommended) | `node --version` |
| **Android Studio / JDK** | JDK 17 / 21 (JBR) | `java -version` |
| **Android SDK** | API 34 (Android 14/15) | Android SDK Manager |

---

## 2. Setting Up the Backend (Python FastAPI)

```bash
# Navigate to backend directory
cd backend

# Install Python dependencies
pip install -r requirements.txt

# Run backend Pytest suite to verify installation
python -m pytest tests/

# Launch development server
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

The API documentation is interactive at:
`http://127.0.0.1:8000/docs`

---

## 3. Setting Up the Web Dashboard (React + TypeScript + Vite)

```bash
# Navigate to dashboard directory
cd dashboard

# Install npm dependencies
npm install

# Run dashboard production build check
npm run build

# Start development server
npm run dev
```

The Web Dashboard will be live at `http://localhost:5173`.

---

## 4. Setting Up & Building the Android Application

1. Open **Android Studio** and click **Open Project**.
2. Select the `android/` directory inside `theft.in`.
3. Wait for Gradle sync to complete.
4. Ensure target device or emulator is running (API 26+).
5. Build and install APK:
   ```bash
   cd android
   ./gradlew assembleDebug
   ```

---

## 5. Registering 4 Android Devices Under One Account

1. Open `http://localhost:5173` in your browser.
2. Sign up with your email (e.g., `owner@example.com`).
3. In the Dashboard header, click **Register Device**.
4. Create 4 separate device profiles:
   - **Device 1**: "My Main Phone" (Pixel 8 Pro)
   - **Device 2**: "Backup Phone" (Galaxy S24)
   - **Device 3**: "Tablet" (Pixel Tablet)
   - **Device 4**: "Spare Phone" (OnePlus 12)
5. Each device is assigned a unique `device_token` for authorization header `X-Device-Token`.

---

## 6. Testing Offline & Airplane Mode Behavior

1. Install the APK on an Android device or emulator.
2. Enable **Airplane Mode** or disable Wi-Fi/Cellular data.
3. Observe that location fixes continue being generated locally and stored in the **Room Database** with state `PENDING` and `is_offline_record = true`.
4. Turn **Airplane Mode OFF** / restore network connection.
5. The `SyncWorker` and `LocationService` immediately detect network restoration and flush the queued records in chronological batches to `POST /devices/{id}/locations/batch`.
6. Verify on the Dashboard under **Location History** that offline locations display the **Offline Sync** badge with exact original timestamps.
