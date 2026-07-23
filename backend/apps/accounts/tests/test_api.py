import pytest
from rest_framework.test import APIClient


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.mark.django_db
def test_full_register_me_refresh_logout_flow(api_client):
    register_resp = api_client.post(
        "/api/v1/auth/register",
        {"email": "flow@example.com", "password": "s3cur3pass", "full_name": "Flow User"},
        format="json",
    )
    assert register_resp.status_code == 201
    body = register_resp.json()
    assert body["user"]["email"] == "flow@example.com"
    assert "password" not in body["user"]
    tokens = body["tokens"]

    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    me_resp = api_client.get("/api/v1/auth/me")
    assert me_resp.status_code == 200
    assert me_resp.json()["email"] == "flow@example.com"

    refresh_resp = api_client.post(
        "/api/v1/auth/refresh", {"refresh": tokens["refresh"]}, format="json"
    )
    assert refresh_resp.status_code == 200
    assert "access" in refresh_resp.json()

    logout_resp = api_client.post(
        "/api/v1/auth/logout", {"refresh": tokens["refresh"]}, format="json"
    )
    assert logout_resp.status_code == 204


@pytest.mark.django_db
def test_register_rejects_a_short_password(api_client):
    resp = api_client.post(
        "/api/v1/auth/register", {"email": "short@example.com", "password": "short"}, format="json"
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_register_duplicate_email_returns_409_in_the_standard_error_envelope(api_client):
    api_client.post(
        "/api/v1/auth/register",
        {"email": "dup2@example.com", "password": "s3cur3pass"},
        format="json",
    )
    resp = api_client.post(
        "/api/v1/auth/register",
        {"email": "dup2@example.com", "password": "s3cur3pass"},
        format="json",
    )

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "email_already_registered"


@pytest.mark.django_db
def test_login_wrong_password_returns_401_in_the_standard_error_envelope(api_client):
    api_client.post(
        "/api/v1/auth/register",
        {"email": "wp@example.com", "password": "correct-pass"},
        format="json",
    )
    resp = api_client.post(
        "/api/v1/auth/login", {"email": "wp@example.com", "password": "wrong-pass"}, format="json"
    )

    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "invalid_credentials"


@pytest.mark.django_db
def test_me_requires_authentication(api_client):
    resp = api_client.get("/api/v1/auth/me")

    assert resp.status_code == 401


@pytest.mark.django_db
def test_logout_requires_authentication(api_client):
    resp = api_client.post("/api/v1/auth/logout", {"refresh": "whatever"}, format="json")

    assert resp.status_code == 401
