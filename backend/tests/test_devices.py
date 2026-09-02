def test_register_four_devices(client, user_headers):
    device_names = ["Main Phone", "Backup Phone", "Tablet", "Spare Phone"]
    registered = []

    for name in device_names:
        res = client.post(
            "/api/v1/devices/register",
            json={
                "device_name": name,
                "device_model": f"Model {name}",
                "android_version": "14.0",
                "app_version": "1.0.0"
            },
            headers=user_headers
        )
        assert res.status_code == 201
        data = res.json()
        assert data["device_name"] == name
        assert "device_token" in data
        registered.append(data)

    # Verify listing 4 devices
    list_res = client.get("/api/v1/devices", headers=user_headers)
    assert list_res.status_code == 200
    devices = list_res.json()
    assert len(devices) == 4

def test_device_ownership_forbidden(client, test_user):
    # Register user 2
    res2 = client.post(
        "/api/v1/auth/register",
        json={"email": "otheruser@example.com", "password": "Password123!"}
    )
    user2_id = res2.json()["id"]

    login_res = client.post(
        "/api/v1/auth/login",
        json={"email": "otheruser@example.com", "password": "Password123!"}
    )
    user2_headers = {"Authorization": f"Bearer {login_res.json()['access_token']}"}

    # User 2 registers a device
    dev_res = client.post(
        "/api/v1/devices/register",
        json={"device_name": "User 2 Phone"},
        headers=user2_headers
    )
    user2_dev_id = dev_res.json()["id"]

    # User 1 tries to access User 2's device -> 403 Forbidden
    login_user1 = client.post(
        "/api/v1/auth/login",
        json={"email": test_user.email, "password": "Secret123!"}
    )
    user1_headers = {"Authorization": f"Bearer {login_user1.json()['access_token']}"}

    access_res = client.get(f"/api/v1/devices/{user2_dev_id}", headers=user1_headers)
    assert access_res.status_code == 403
