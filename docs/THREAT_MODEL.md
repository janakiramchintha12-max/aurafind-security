# AuraFind Threat Model & Adversarial Analysis

---

## 1. Threat Actors & Adversarial Scenarios

| Threat Actor | Motivation / Attack Vector | AuraFind Architectural Defense |
| :--- | :--- | :--- |
| **Rogue / Malicious Account Administrator** | Attempts to covertly spy on an employee or family member's camera or microphone. | **Device-Controlled Privacy**: The handset holder can toggle any sensor to `PAUSED`. Backend rejects remote requests with `403 Forbidden` and records an immutable audit log. No admin override exists. |
| **Physical Thief / Intruder** | Steals physical phone, attempts PIN brute-force, turns on Airplane Mode, or removes SIM. | **Intruder Selfie & Telemetry Catch**: Front camera captures high-res intruder snapshot on failed PIN attempts. Offline Room DB records location and auto-syncs when reconnecting. SIM change triggers forensic carrier alert. |
| **Man-in-the-Middle (MitM) Network Adversary** | Attempts to intercept telemetry or inject fake remote wipe commands. | **TLS 1.3 Transport Encryption & Token Verification**: All traffic encrypted over HTTPS/WSS. Device tokens and JWT signatures validated per request. |
| **SIM Swapper / Port-Out Attacker** | Swaps SIM card to bypass SMS 2FA. | **Forensic Carrier State Tracking**: App detects IMSI/SIM state change immediately and logs SIM card removal event to the server. |
| **Network Loss / Cloud Dropout** | Phone disconnected or out of cellular coverage during theft. | **Offline Engine Queue**: Android Room DB holds up to 1,000+ points locally, re-syncing in chronological order upon network recovery. |

---

## 2. Sensor Gating Proof Matrix

```
[Web User Triggers Camera / Mic]
             |
             v
[FastAPI Backend: Is Camera/Mic Paused on Device?]
       /                 \
     YES                  NO
     /                     \
[403 Forbidden]     [Queue & Dispatch Command]
[Log Rejection]            |
                    [Android Client: Verify Local PrivacyManager]
                           /                 \
                         PAUSED            ALLOWED
                         /                     \
                   [Reject Execution]    [Hardware Capture]
                   [Notify Server]       [OS Privacy Indicator]
```
