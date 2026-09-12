"""Short-lived server-side state, and the outage that proved it is not a cache.

── WHAT HAPPENED ─────────────────────────────────────────────────────────

Google sign-in was completely broken in production and `/health/` reported:

    {"status": "ok", "checks": {"database": true, "cache": false},
     "degraded": ["cache"]}

That answer was correct. CLAUDE.md's readiness rule — "the database decides
readiness, the cache never does" — is correct too, because every READ path on
this platform is cache-aside and falls through to a query the database can
still answer.

Two paths were not reads. The OAuth `state` for Google sign-in and for the
Calendar connection were stored in `CachePort` with no fallback, so with the
cache degraded `set` was a no-op, `get` returned nothing, and every callback
raised `OAuthStateInvalidError` — rendered to the user as "That sign-in link
expired or was already used." Nothing failed. Nothing was logged. Measured on
the deployed site: a state issued seconds earlier was already invalid.

The rule this file pins: **if losing it breaks a user-visible flow, it is not
a cache.**
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from core import ephemeral
from core.models import EphemeralToken

pytestmark = pytest.mark.django_db


class TestIssueAndConsume:
    def test_a_token_hands_back_exactly_what_it_was_given(self):
        ephemeral.issue(
            purpose=ephemeral.SIGN_IN_STATE,
            token="tok-1",
            payload={"code_verifier": "v", "next": "/tickets"},
            ttl_seconds=600,
        )

        assert ephemeral.consume(purpose=ephemeral.SIGN_IN_STATE, token="tok-1") == {
            "code_verifier": "v",
            "next": "/tickets",
        }

    def test_it_is_single_use(self):
        # A replayed callback must find nothing. This is the property that
        # makes an intercepted authorization code worthless once it has been
        # spent once.
        ephemeral.issue(
            purpose=ephemeral.SIGN_IN_STATE, token="tok-2", payload={"a": 1}, ttl_seconds=600
        )

        assert ephemeral.consume(purpose=ephemeral.SIGN_IN_STATE, token="tok-2") is not None
        assert ephemeral.consume(purpose=ephemeral.SIGN_IN_STATE, token="tok-2") is None

    def test_consuming_deletes_the_row_rather_than_marking_it(self):
        # Single use is enforced by the row ceasing to exist, so it cannot be
        # bypassed by a caller that forgets to check a flag — and the PKCE
        # verifier stops being readable the moment the flow is over.
        ephemeral.issue(purpose=ephemeral.SIGN_IN_STATE, token="tok-3", payload={}, ttl_seconds=600)
        ephemeral.consume(purpose=ephemeral.SIGN_IN_STATE, token="tok-3")

        assert not EphemeralToken.objects.filter(token="tok-3").exists()

    def test_an_unknown_token_is_simply_absent(self):
        assert ephemeral.consume(purpose=ephemeral.SIGN_IN_STATE, token="never-existed") is None

    def test_an_expired_token_is_refused_and_removed(self):
        ephemeral.issue(
            purpose=ephemeral.SIGN_IN_STATE, token="tok-4", payload={"a": 1}, ttl_seconds=600
        )
        EphemeralToken.objects.filter(token="tok-4").update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )

        assert ephemeral.consume(purpose=ephemeral.SIGN_IN_STATE, token="tok-4") is None
        # Swept on the way past; the scheduled purge is a backstop for rows
        # nobody ever comes back for, not the thing that makes expiry correct.
        assert not EphemeralToken.objects.filter(token="tok-4").exists()


class TestThePurposeNamespace:
    def test_the_same_token_in_two_purposes_is_two_tokens(self):
        # `(purpose, token)` is the key. Unique on `token` alone would let one
        # flow's value refuse another flow's perfectly good one.
        ephemeral.issue(
            purpose=ephemeral.SIGN_IN_STATE,
            token="same",
            payload={"which": "state"},
            ttl_seconds=60,
        )
        ephemeral.issue(
            purpose=ephemeral.CALENDAR_STATE,
            token="same",
            payload={"which": "calendar"},
            ttl_seconds=60,
        )

        assert ephemeral.consume(purpose=ephemeral.SIGN_IN_STATE, token="same") == {
            "which": "state"
        }
        assert ephemeral.consume(purpose=ephemeral.CALENDAR_STATE, token="same") == {
            "which": "calendar"
        }

    def test_a_token_cannot_be_consumed_through_the_wrong_purpose(self):
        ephemeral.issue(
            purpose=ephemeral.SIGN_IN_STATE, token="tok-5", payload={"a": 1}, ttl_seconds=60
        )
        assert ephemeral.consume(purpose=ephemeral.CALENDAR_STATE, token="tok-5") is None
        # And the real one is untouched by the miss.
        assert ephemeral.consume(purpose=ephemeral.SIGN_IN_STATE, token="tok-5") == {"a": 1}


class TestThePurge:
    def test_it_takes_the_expired_and_leaves_the_live(self):
        ephemeral.issue(purpose=ephemeral.SIGN_IN_STATE, token="live", payload={}, ttl_seconds=600)
        ephemeral.issue(purpose=ephemeral.SIGN_IN_STATE, token="dead", payload={}, ttl_seconds=600)
        EphemeralToken.objects.filter(token="dead").update(
            expires_at=timezone.now() - timedelta(minutes=1)
        )

        assert ephemeral.purge_expired() == 1
        assert EphemeralToken.objects.filter(token="live").exists()
        assert not EphemeralToken.objects.filter(token="dead").exists()

    def test_it_is_bounded(self):
        # A table left to grow is cleared over several ticks rather than in one
        # long statement holding locks.
        for index in range(5):
            ephemeral.issue(
                purpose=ephemeral.SIGN_IN_STATE, token=f"old-{index}", payload={}, ttl_seconds=600
            )
        EphemeralToken.objects.all().update(expires_at=timezone.now() - timedelta(minutes=1))

        assert ephemeral.purge_expired(limit=2) == 2
        assert EphemeralToken.objects.count() == 3

    def test_nothing_to_do_is_not_an_error(self):
        assert ephemeral.purge_expired() == 0
