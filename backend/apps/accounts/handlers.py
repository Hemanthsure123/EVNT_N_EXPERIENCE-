"""accounts has no domain-event observers of its own.

The welcome email that used to live here now belongs to the `notifications`
module: accounts EMITS `USER_REGISTERED` (see services.AuthService.register),
and notifications subscribes to it and owns rendering, delivery, dedupe and
logging — one home for all user messaging. This file is kept as the module
shape's placeholder; add a handler here only if accounts needs to react to
another module's event.
"""

from __future__ import annotations
