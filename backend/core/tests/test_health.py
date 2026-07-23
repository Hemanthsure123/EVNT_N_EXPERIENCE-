import pytest


@pytest.mark.django_db
def test_health_check_reports_ok(client):
    response = client.get("/health/")

    assert response.status_code == 200
    body = response.json()
    assert body == {"status": "ok", "checks": {"database": True, "cache": True}}


@pytest.mark.django_db
def test_health_check_does_not_require_authentication(client):
    response = client.get("/health/")

    assert response.status_code != 401
    assert response.status_code != 403
