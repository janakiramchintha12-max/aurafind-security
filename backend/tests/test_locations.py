from datetime import datetime, timezone

def test_location_single_and_batch(client, user_headers):
    # Register device
    dev_res = client.post(
        "/api/v1/devices/register",
        json={"device_name": "Test Tracking Phone"},
        headers=user_headers
    )
    dev = dev_res.json()
    dev_id = dev["id"]
    dev_token = dev["device_token"]

    device_headers = {"X-Device-Token": dev_token}

    # Single location upload
    now_str = datetime.now(timezone.utc).isoformat()
    loc_res = client.post(
        f"/api/v1/devices/{dev_id}/locations",
        json={
            "latitude": 37.7749,
            "longitude": -122.4194,
            "accuracy": 5.0,
            "provider": "fused",
            "battery_level": 85.0,
            "client_timestamp": now_str
        },
        headers=device_headers
    )
    assert loc_res.status_code == 201
    assert loc_res.json()["latitude"] == 37.7749

    # Batch upload (simulating airplane mode sync)
    batch_res = client.post(
        f"/api/v1/devices/{dev_id}/locations/batch",
        json={
            "locations": [
                {
                    "latitude": 37.7750,
                    "longitude": -122.4195,
                    "accuracy": 6.0,
                    "is_offline_record": True,
                    "client_timestamp": "2026-08-24T10:00:00Z"
                },
                {
                    "latitude": 37.7751,
                    "longitude": -122.4196,
                    "accuracy": 4.0,
                    "is_offline_record": True,
                    "client_timestamp": "2026-08-24T10:05:00Z"
                }
            ]
        },
        headers=device_headers
    )
    assert batch_res.status_code == 200
    assert batch_res.json()["processed_count"] == 2

    # Query location history from user dashboard
    history_res = client.get(
        f"/api/v1/devices/{dev_id}/locations?range=30days",
        headers=user_headers
    )
    assert history_res.status_code == 200
    assert len(history_res.json()) >= 3
