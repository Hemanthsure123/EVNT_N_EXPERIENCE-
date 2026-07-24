"""notifications has NO public HTTP endpoints — it is an internal, event- and
job-driven module (subscribers + background tasks), so there is nothing to
route. This file exists to keep the module shape uniform; operator visibility
into the NotificationLog is provided through the Django admin (admin.py) and the
read-side selectors, not a REST surface. Add a view here only if a genuine
internal/ops endpoint (e.g. replay a dead-letter) is later required.
"""

from __future__ import annotations
