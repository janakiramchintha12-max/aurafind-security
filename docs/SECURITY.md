# AuraFind Security Policy & Safeguards

---

## 1. Authentication & Cryptographic Identity

- **User Authentication**: Standardized JWT (JSON Web Token) with HMAC-SHA256 signature, rotating access tokens, and salted/hashed passwords using `bcrypt` (work factor 12).
- **Device Authentication**: Authenticated via high-entropy cryptographically random device tokens (`X-Device-Token`) bound to the device's hardware ID and ECDSA public key.
- **Strict IDOR Ownership Protection**: Every endpoint under `/api/v1/devices/{device_id}/*` validates that the authenticated JWT `user_id` is the verified database owner of the requested `device_id`. Cross-user access attempts return `HTTP 403 Forbidden` and trigger an automated security audit entry.

---

## 2. Immutable Cryptographic Audit System

All sensitive actions, sensor activations, privacy modifications, and rejected command dispatches are logged to an append-only audit stream:

- **Events Recorded**:
  - `DEVICE_ENROLLED`
  - `DEVICE_ENROLLMENT_REVOKED`
  - `DEVICE_PRIVACY_UPDATED`
  - `REMOTE_CAMERA_REQUEST_REJECTED`
  - `REMOTE_MIC_REQUEST_REJECTED`
  - `REMOTE_LOCATION_REQUEST_REJECTED`
  - `REMOTE_SPEAKER_REQUEST_REJECTED`
  - `REMOTE_CONTROLS_REQUEST_REJECTED`
  - `COMMAND_DISPATCHED`
  - `INTRUDER_ALERT_CAPTURED`
- **Tamper Evidence**: Log entries include millisecond-precision UTC timestamps, actor user ID, client IP address, target resource, and rejection rationale.

---

## 3. Platform & OS Compliance

- **Android 14+ Foreground Service Standard**: All location, camera, and microphone operations run bound to declared foreground service types (`FOREGROUND_SERVICE_TYPE_LOCATION`, `FOREGROUND_SERVICE_TYPE_CAMERA`).
- **No Background Exploits**: Zero use of hidden accessibility overlays, covert background microphone recording, or hidden system services.
- **Android Hardware Indicators**: Complies with Android 12+ green dot hardware microphone and camera indicators.

---

## 4. Vulnerability Reporting & Disclosure

To report a vulnerability or security concern, please open a confidential advisory or contact the security maintainers with a reproducible proof of concept.
