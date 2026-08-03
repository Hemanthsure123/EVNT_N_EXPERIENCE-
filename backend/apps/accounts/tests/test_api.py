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

    # Registration issues no session. Verifying the address is what does.
    verify_resp = api_client.post(
        "/api/v1/auth/verify-email",
        {"email": "flow@example.com", "code": _code_for("flow@example.com")},
        format="json",
    )
    assert verify_resp.status_code == 200
    tokens = verify_resp.json()["tokens"]

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


# ── EMAIL VERIFICATION ────────────────────────────────────────────────────
#
# The whole point of the flow is that an account is not USABLE until the
# address is proven, so these assert what a caller cannot do as much as what
# they can.


def _code_for(email: str) -> str:
    from apps.accounts.models import EmailVerification, User
    from apps.notifications.models import NotificationLog

    user = User.objects.get(email=email)
    newest = EmailVerification.objects.filter(user=user).order_by("-created_at", "-id").first()
    assert newest is not None
    log = NotificationLog.objects.get(dedupe_key=f"verify:{newest.id}")
    return "".join(ch for ch in log.subject if ch.isdigit())[:6]


@pytest.mark.django_db
def test_registration_returns_no_tokens_and_asks_for_verification(api_client):
    """Handing out a session at registration would make verification optional
    in practice — keep the token, never open the email."""
    resp = api_client.post(
        "/api/v1/auth/register",
        {"email": "verify-me@example.com", "password": "s3cur3pass"},
        format="json",
    )

    assert resp.status_code == 201
    body = resp.json()
    assert "tokens" not in body
    assert body["verification_required"] is True
    assert body["user"]["email_verified"] is False


@pytest.mark.django_db
def test_an_unverified_account_cannot_sign_in(api_client):
    api_client.post(
        "/api/v1/auth/register",
        {"email": "unverified@example.com", "password": "s3cur3pass"},
        format="json",
    )

    resp = api_client.post(
        "/api/v1/auth/login",
        {"email": "unverified@example.com", "password": "s3cur3pass"},
        format="json",
    )

    assert resp.status_code == 401
    # A DISTINCT code from invalid_credentials, so the frontend can offer to
    # resend rather than telling somebody their password is wrong.
    assert resp.json()["error"]["code"] == "email_not_verified"


@pytest.mark.django_db
def test_a_wrong_password_does_not_reveal_that_the_account_needs_verifying(api_client):
    """Answering `email_not_verified` before checking the password would
    confirm an account exists for that address."""
    api_client.post(
        "/api/v1/auth/register",
        {"email": "enum@example.com", "password": "s3cur3pass"},
        format="json",
    )

    resp = api_client.post(
        "/api/v1/auth/login",
        {"email": "enum@example.com", "password": "WRONG-PASSWORD"},
        format="json",
    )

    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "invalid_credentials"


@pytest.mark.django_db
def test_verifying_signs_the_user_in(api_client):
    api_client.post(
        "/api/v1/auth/register",
        {"email": "happy@example.com", "password": "s3cur3pass"},
        format="json",
    )

    resp = api_client.post(
        "/api/v1/auth/verify-email",
        {"email": "happy@example.com", "code": _code_for("happy@example.com")},
        format="json",
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["user"]["email_verified"] is True
    # Verification IS the sign-in, rather than a step followed by a login.
    assert body["tokens"]["access"]

    login = api_client.post(
        "/api/v1/auth/login",
        {"email": "happy@example.com", "password": "s3cur3pass"},
        format="json",
    )
    assert login.status_code == 200


@pytest.mark.django_db
def test_a_wrong_code_is_a_422_in_the_standard_envelope(api_client):
    api_client.post(
        "/api/v1/auth/register",
        {"email": "wrongcode@example.com", "password": "s3cur3pass"},
        format="json",
    )

    resp = api_client.post(
        "/api/v1/auth/verify-email",
        {"email": "wrongcode@example.com", "code": "000000"},
        format="json",
    )

    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "verification_code_invalid"


@pytest.mark.django_db
def test_a_malformed_code_is_rejected_at_the_boundary(api_client):
    """Validated by the serializer, so a typo never reaches the service and
    never costs one of the five attempts."""
    api_client.post(
        "/api/v1/auth/register",
        {"email": "malformed@example.com", "password": "s3cur3pass"},
        format="json",
    )

    resp = api_client.post(
        "/api/v1/auth/verify-email",
        {"email": "malformed@example.com", "code": "12ab"},
        format="json",
    )

    assert resp.status_code == 400
    from apps.accounts.models import EmailVerification

    assert EmailVerification.objects.get().attempts == 0


@pytest.mark.django_db
def test_an_unknown_address_and_a_wrong_code_look_identical(api_client):
    """Otherwise verify becomes an oracle for which addresses are registered."""
    resp = api_client.post(
        "/api/v1/auth/verify-email",
        {"email": "nobody@example.com", "code": "123456"},
        format="json",
    )

    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "verification_code_invalid"


@pytest.mark.django_db
def test_resend_accepts_an_unknown_address_without_saying_so(api_client):
    resp = api_client.post(
        "/api/v1/auth/verify-email/resend",
        {"email": "ghost@example.com"},
        format="json",
    )
    assert resp.status_code == 202


@pytest.mark.django_db
def test_resend_inside_the_cooldown_reports_how_long_to_wait(api_client):
    api_client.post(
        "/api/v1/auth/register",
        {"email": "cooldown@example.com", "password": "s3cur3pass"},
        format="json",
    )

    resp = api_client.post(
        "/api/v1/auth/verify-email/resend",
        {"email": "cooldown@example.com"},
        format="json",
    )

    assert resp.status_code == 422
    body = resp.json()["error"]
    assert body["code"] == "verification_cooldown"
    # The frontend counts down with this rather than guessing.
    assert body["details"]["seconds_remaining"] > 0
