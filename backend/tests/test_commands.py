def test_command_dispatch_and_execution(client, user_headers):
    # Register device
    dev_res = client.post(
        "/api/v1/devices/register",
        json={"device_name": "Command Target Device"},
        headers=user_headers
    )
    dev = dev_res.json()
    dev_id = dev["id"]
    dev_token = dev["device_token"]

    # Dispatch PLAY_ALARM command from user dashboard
    cmd_res = client.post(
        f"/api/v1/devices/{dev_id}/commands",
        json={
            "command_type": "PLAY_ALARM",
            "payload": '{"duration_seconds": 30}'
        },
        headers=user_headers
    )
    assert cmd_res.status_code == 201
    cmd = cmd_res.json()
    assert cmd["command_type"] == "PLAY_ALARM"
    assert cmd["status"] in ["PENDING", "SENT"]
    cmd_id = cmd["id"]

    # Device fetches pending commands
    device_headers = {"X-Device-Token": dev_token}
    pending_res = client.get(f"/api/v1/devices/{dev_id}/commands/pending", headers=device_headers)
    assert pending_res.status_code == 200
    pending_cmds = pending_res.json()
    assert any(c["id"] == cmd_id for c in pending_cmds)

    # Device submits result after playing alarm
    result_res = client.patch(
        f"/api/v1/devices/{dev_id}/commands/{cmd_id}/result",
        json={
            "status": "EXECUTED",
            "result": "Alarm played successfully at max volume"
        },
        headers=device_headers
    )
    assert result_res.status_code == 200
    assert result_res.json()["status"] == "EXECUTED"
