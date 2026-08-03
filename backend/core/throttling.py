"""Rate limits.

The platform had none. `POST /auth/login` was an unmetered password oracle:
a stolen credential list could be tried at whatever rate the network
allowed, and nothing in the stack would notice — no counter, no log line, no
lockout. Registration was an unmetered account-creation endpoint, and the
OTP endpoint, once it lands, spends real money per request.

Four things make a limiter real rather than decorative, and each is handled
here rather than assumed:

1. **Shared state.** DRF's throttles use Django's cache, whose default is
   per-process LocMemCache — so with six replicas a "10/min" limit is really
   60/min and resets on every deploy. `CACHES["default"]` points at the same
   Redis as everything else (settings), so the ceiling is the number written
   down.

2. **The right identity.** Behind a load balancer every request arrives from
   the balancer's IP, so an IP-keyed limit becomes one global bucket. DRF
   reads `X-Forwarded-For` only when `NUM_PROXIES` is set; see that setting's
   comment for why the number must match the real hop count.

3. **Actually being applied.** These subclass `SimpleRateThrottle` with a
   fixed `scope`, NOT `ScopedRateThrottle`. That is not a style choice —
   `ScopedRateThrottle.allow_request` reads `view.throttle_scope` and
   **returns True when it is absent**, so a throttle attached only via
   `throttle_classes` silently permits everything. The first version of this
   file made exactly that mistake and every test of a scope's rate still
   passed; only firing real requests at the live view caught it.

4. **Failing open, deliberately.** If Redis is down, `SimpleRateThrottle`
   raises and every request 500s — the cache being unavailable would take
   out sign-in, checkout and the gate. These catch that and ALLOW, logging
   at error. A brief window of unmetered requests is survivable; a shut door
   at a venue is not. The paths that must stay correct regardless — webhook
   signature verification, the per-ticket row lock — do not depend on this.
"""

from __future__ import annotations

import logging

from rest_framework.throttling import AnonRateThrottle, SimpleRateThrottle, UserRateThrottle

logger = logging.getLogger(__name__)


class _FailOpenMixin:
    """Never let the rate limiter itself be the outage.

    Deliberately does NOT declare `scope`: `SimpleRateThrottle` already does,
    and re-declaring it here makes every subclass an incompatible-override
    error under mypy's multiple-inheritance rules.
    """

    def allow_request(self, request, view) -> bool:
        try:
            return super().allow_request(request, view)  # type: ignore[misc]
        except Exception:
            # Deliberately broad: a redis-py timeout, a connection reset and a
            # DNS failure are different exception types and identical in
            # consequence. Logged at error so it pages, rather than being
            # absorbed as normal operation.
            logger.error(
                "throttle.backend_unavailable",
                exc_info=True,
                extra={"scope": getattr(self, "scope", "?")},
            )
            return True


class BurstAnonThrottle(_FailOpenMixin, AnonRateThrottle):
    """The default ceiling for unauthenticated traffic, keyed on client IP."""


class BurstUserThrottle(_FailOpenMixin, UserRateThrottle):
    """The default ceiling for authenticated traffic, keyed on user id.

    Keyed on the USER, not the IP: an office, a campus or a mobile carrier's
    NAT puts thousands of legitimate people behind one address, and an
    IP-keyed limit on authenticated traffic throttles all of them because one
    of them was busy.
    """


class _IpScopedThrottle(_FailOpenMixin, SimpleRateThrottle):
    """A named rate keyed on client IP, applied by class alone.

    `scope` is a class attribute that `SimpleRateThrottle.__init__` reads to
    look up the rate, so `throttle_classes = [AuthThrottle]` is complete on
    its own — there is no `throttle_scope` on the view to also remember.
    """

    def get_cache_key(self, request, view) -> str:
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class _UserScopedThrottle(_FailOpenMixin, SimpleRateThrottle):
    """A named rate keyed on the authenticated user."""

    def get_cache_key(self, request, view) -> str | None:
        if not (request.user and request.user.is_authenticated):
            # None means "not throttled by this class". Safe only where the
            # endpoint requires an account anyway, so `anon` covers the
            # attempt — never use this shape on an anonymous-reachable write.
            return None
        return self.cache_format % {"scope": self.scope, "ident": request.user.pk}


class AuthThrottle(_IpScopedThrottle):
    """Sign-in, registration and refresh. The credential-guessing surface.

    Keyed on IP even though refresh carries a token, because the whole point
    is to limit somebody who does not have a valid identity yet.
    """

    scope = "auth"


class OtpThrottle(_IpScopedThrottle):
    """One-time-code requests.

    Tighter than `auth` and measured per hour, because every request sends a
    real SMS that costs real money — a spend limit as much as a security
    control. The endpoint should ALSO key on the destination phone number so
    one number cannot be flooded from many addresses (see
    REAL_INTEGRATIONS_AUDIT.md, "Phone/OTP sign-in").
    """

    scope = "otp"


class WebhookThrottle(_IpScopedThrottle):
    """Payment webhooks.

    Set well ABOVE the vendor's retry schedule on purpose. The signature is
    the real gate; this exists only so an unsigned flood cannot exhaust
    workers before reaching it. Throttling a genuine Razorpay retry would
    delay a ticket the customer has already paid for.
    """

    scope = "webhook"


class CheckinThrottle(_IpScopedThrottle):
    """Gate scanning.

    High deliberately. During entry a gate scans continuously, and denying a
    real scan means a queue at a door — much worse than absorbing a fake one,
    which the per-ticket row lock already makes harmless.
    """

    scope = "checkin"


class AnonWriteThrottle(_IpScopedThrottle):
    """An unauthenticated write, keyed on IP.

    Exactly one endpoint needs this: the push-subscription rotation the
    service worker calls, which cannot carry a token because a service worker
    has none. `WriteThrottle` would be wrong there — it keys on the user id
    and returns `None` for an anonymous caller, so the one endpoint that most
    needs a limit would have had none at all.
    """

    scope = "write"


class MapsThrottle(_UserScopedThrottle):
    """Google Maps Platform calls.

    A SPEND limit as much as an abuse control: every Places, Geocoding,
    Directions and Distance Matrix call is billed, and autocomplete fires per
    keystroke. Keyed on the user so one organizer holding down a key in the
    venue picker cannot exhaust the budget for everybody else.

    The two PUBLIC Maps endpoints — directions and the photo proxy — fall
    back to the `anon` IP-keyed ceiling for signed-out visitors, because
    `_UserScopedThrottle` returns None for them. That is correct here: both
    are heavily cached, so an anonymous flood mostly hits Redis rather than
    Google.
    """

    scope = "maps"


class UploadThrottle(_UserScopedThrottle):
    """File uploads: bytes in, content validation, storage cost. Keyed on the
    account the cost lands on."""

    scope = "upload"


class WriteThrottle(_UserScopedThrottle):
    """The general authenticated write budget, for endpoints that create rows
    or move money. Not applied to reads — a browse page is edge-cached and
    costs nothing to serve twice."""

    scope = "write"
