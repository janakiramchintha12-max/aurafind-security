def test_register_user(client):
    response = client.post(
        "/api/v1/auth/register",
        json={"email": "newuser@example.com", "password": "Password123!", "full_name": "New User"}
    )
    assert response.status_code == 201
    data = response.json()
    assert data["email"] == "newuser@example.com"
    assert "id" in data

def test_login_user(client, test_user):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": test_user.email, "password": "Secret123!"}
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert "refresh_token" in data

def test_login_invalid_password(client, test_user):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": test_user.email, "password": "WrongPassword!"}
    )
    assert response.status_code == 401

def test_refresh_token(client, test_user):
    login_res = client.post(
        "/api/v1/auth/login",
        json={"email": test_user.email, "password": "Secret123!"}
    )
    refresh_token = login_res.json()["refresh_token"]

    ref_res = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_token}
    )
    assert ref_res.status_code == 200
    assert "access_token" in ref_res.json()
