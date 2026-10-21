import os
import json
import logging
from datetime import datetime, timezone
from app.models.device import Device

logger = logging.getLogger("aurafind.registry")
REGISTRY_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "database", "devices_registry.json")

def load_registry_devices(db, admin_user_id: str):
    """Restores all persistent devices from devices_registry.json into SQLite on container start."""
    if not os.path.exists(REGISTRY_PATH):
        return
    try:
        with open(REGISTRY_PATH, "r", encoding="utf-8") as f:
            devices_data = json.load(f)
        for d in devices_data:
            existing = db.query(Device).filter(Device.id == d["id"]).first()
            if not existing:
                dev = Device(
                    id=d["id"],
                    user_id=admin_user_id,
                    device_token=d.get("device_token", ""),
                    device_name=d.get("device_name", "Android Device"),
                    device_model=d.get("device_model", "Android Handset"),
                    android_version=d.get("android_version", "14"),
                    app_version=d.get("app_version", "1.0.0"),
                    battery_pct=d.get("battery_pct", 100.0),
                    is_charging=d.get("is_charging", False),
                    status=d.get("status", "ONLINE"),
                    enrollment_status=d.get("enrollment_status", "ENROLLED"),
                    sim_status=d.get("sim_status", False),
                    sim_number=d.get("sim_number", None),
                    last_heartbeat=datetime.now(timezone.utc)
                )
                db.add(dev)
            else:
                existing.user_id = admin_user_id
        db.commit()
        logger.info(f"[Registry] Restored {len(devices_data)} devices from persistent registry.")
    except Exception as e:
        logger.warning(f"[Registry] Error restoring devices: {e}")

def sync_device_to_registry(device: Device):
    """Saves or updates a device record in devices_registry.json so it persists across container restarts."""
    try:
        devices_data = []
        if os.path.exists(REGISTRY_PATH):
            with open(REGISTRY_PATH, "r", encoding="utf-8") as f:
                try:
                    devices_data = json.load(f)
                except Exception:
                    devices_data = []

        found = False
        for item in devices_data:
            if item.get("id") == device.id:
                item["device_token"] = device.device_token
                item["device_name"] = device.device_name
                item["device_model"] = device.device_model
                item["android_version"] = device.android_version
                item["app_version"] = device.app_version
                item["battery_pct"] = device.battery_pct
                item["is_charging"] = device.is_charging
                item["status"] = device.status
                item["enrollment_status"] = device.enrollment_status
                item["sim_status"] = device.sim_status
                item["sim_number"] = device.sim_number
                found = True
                break

        if not found:
            devices_data.append({
                "id": device.id,
                "device_token": device.device_token,
                "device_name": device.device_name,
                "device_model": device.device_model,
                "android_version": device.android_version,
                "app_version": device.app_version,
                "battery_pct": device.battery_pct,
                "is_charging": device.is_charging,
                "status": device.status,
                "enrollment_status": device.enrollment_status,
                "sim_status": device.sim_status,
                "sim_number": device.sim_number
            })

        with open(REGISTRY_PATH, "w", encoding="utf-8") as f:
            json.dump(devices_data, f, indent=2)
    except Exception as e:
        logger.warning(f"[Registry] Error saving device to registry: {e}")

def remove_device_from_registry(device_id: str):
    """Removes a deleted device from devices_registry.json."""
    try:
        if not os.path.exists(REGISTRY_PATH):
            return
        with open(REGISTRY_PATH, "r", encoding="utf-8") as f:
            devices_data = json.load(f)
        devices_data = [d for d in devices_data if d.get("id") != device_id]
        with open(REGISTRY_PATH, "w", encoding="utf-8") as f:
            json.dump(devices_data, f, indent=2)
    except Exception as e:
        logger.warning(f"[Registry] Error removing device: {e}")
