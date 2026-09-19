"""A half-configured optional channel must not take down sign-in.

── THE PRODUCTION FAILURE THIS PINS ──────────────────────────────────────

`VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` were added to enable Web Push.
`VAPID_CONTACT` was not — it is the VAPID `sub` claim and push services reject
a token without one, so `WebPushAdapter.__init__` raises. `push_port()` let
that escape, and the blast radius was nothing like "push is broken":

    /auth/oauth/google/signin/config
      -> build_google_sign_in_service -> build_auth_service
      -> build_email_verification_service -> build_notification_service
      -> push_port()  ->  ValueError  ->  500

`build_notification_service` holds EVERY channel and sits on the path of email
verification, which sits on the path of Google sign-in. So the visible symptom
was a sign-in panel saying "we can't reach the sign-in service", and nothing
anywhere pointed at push.

Push is OPTIONAL; sign-in is not. The rule this file pins is the one
`RedisCacheAdapter` already follows and `/health/` had to learn: **a
non-essential dependency may make the product smaller, never make it refuse.**
`core/preflight.py` refuses the same configuration at boot, so the degradation
cannot be permanent and silent — loud at boot, safe at runtime.
"""

from __future__ import annotations

import pytest
from django.test import override_settings

from config.di import push_port


@pytest.fixture(autouse=True)
def _clear_cache():
    push_port.cache_clear()
    yield
    push_port.cache_clear()


KEYS = {"VAPID_PUBLIC_KEY": "BPublicKey", "VAPID_PRIVATE_KEY": "aPrivateKey"}


@override_settings(PUSH_BACKEND="webpush", VAPID_CONTACT="", **KEYS)
def test_keys_without_a_contact_degrade_instead_of_raising():
    """The exact production configuration. It must return a port, not raise."""
    port = push_port()

    assert port.is_configured() is False
    assert port.public_key() == ""


@override_settings(PUSH_BACKEND="webpush", VAPID_CONTACT="", **KEYS)
def test_the_notification_service_still_builds():
    """The step that actually broke sign-in: `build_notification_service` is on
    the path of email verification, which is on the path of Google sign-in. If
    this raises, an auth endpoint 500s for a push misconfiguration."""
    from config.di import build_notification_service

    assert build_notification_service() is not None


@override_settings(PUSH_BACKEND="webpush", VAPID_CONTACT="", **KEYS)
def test_google_sign_in_availability_still_answers():
    """The endpoint that actually 500'd in production, end to end through the
    same factory chain."""
    from config.di import build_google_sign_in_service

    # A bool either way — what matters is that asking does not raise.
    assert build_google_sign_in_service().is_available() in (True, False)


@override_settings(PUSH_BACKEND="webpush", VAPID_CONTACT="mailto:ops@example.com", **KEYS)
def test_a_complete_configuration_still_enables_push():
    """The degradation must not swallow a working setup."""
    port = push_port()

    assert port.is_configured() is True
    assert port.public_key() == "BPublicKey"


@override_settings(
    PUSH_BACKEND="webpush", VAPID_PUBLIC_KEY="", VAPID_PRIVATE_KEY="", VAPID_CONTACT=""
)
def test_push_left_off_is_unchanged():
    port = push_port()

    assert port.is_configured() is False


@override_settings(PUSH_BACKEND="something-else", **KEYS)
def test_an_unknown_backend_still_raises():
    """NOT everything is degraded away. An unrecognised `PUSH_BACKEND` is a
    typo in configuration rather than a feature left switched off, and there is
    no safe adapter to fall back to — the caller asked for something that does
    not exist."""
    with pytest.raises(ValueError):
        push_port()
