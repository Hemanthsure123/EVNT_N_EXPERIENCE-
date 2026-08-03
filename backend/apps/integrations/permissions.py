"""Object-level permissions for third-party connections.

There are none, and that is the design rather than an omission: every
endpoint in this module reads or writes `request.user`'s OWN connection,
looked up BY that user id. There is no route that takes a connection id, so
there is no object to check ownership on — the query cannot return somebody
else's row.

Kept for module-shape uniformity, and as the seam if an operator-facing
"disconnect this user's Google account" endpoint is ever added. That one
WOULD need a permission class, because it would act on a row the caller
does not own.
"""

from __future__ import annotations
