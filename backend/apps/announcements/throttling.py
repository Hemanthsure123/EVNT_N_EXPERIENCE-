"""The rate limit on the one endpoint here that anyone at all can write to.

`POST /subscribers` is an unauthenticated INSERT. Left unmetered it is a way to
fill a table from a script, and — because a real address receives everything
the operator sends next — a way to point our sending reputation at somebody
else's inbox. Subscription bombing (signing a victim up to thousands of lists
so the confirmation mail buries a fraud alert) is a real, common attack, and
the list that participates in it is the one with no limit on its signup form.

The rate is deliberately far below `write`'s 120/min: a person subscribes once,
so anything above a handful an hour from one address is not a person.
"""

from __future__ import annotations

from rest_framework.settings import api_settings

# Imported rather than reimplemented. `_IpScopedThrottle` is core's own base for
# "a named rate keyed on client IP, applied by class alone" and it carries the
# fail-open behaviour every throttle in this codebase must have (see
# core/throttling.py's header — a limiter that 500s when Redis is down takes out
# the endpoint it was protecting). A local copy would be a second, drifting
# implementation of that rule.
from core.throttling import _IpScopedThrottle

#: Used when no `subscribe` rate is configured, so the limit is real on a fresh
#: deployment rather than dependent on somebody remembering an env var. An
#: operator who adds `THROTTLE_SUBSCRIBE` to `DEFAULT_THROTTLE_RATES` overrides
#: it with no code change.
DEFAULT_SUBSCRIBE_RATE = "6/hour"


class SubscribeThrottle(_IpScopedThrottle):
    scope = "subscribe"

    def get_rate(self) -> str:
        # `SimpleRateThrottle.get_rate` raises when the scope is missing from
        # settings. Falling back here instead means this module ships working
        # without an edit to a settings file another slice owns, and still
        # honours a rate an operator sets.
        configured = api_settings.DEFAULT_THROTTLE_RATES.get(self.scope)
        return str(configured) if configured else DEFAULT_SUBSCRIBE_RATE
