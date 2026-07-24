"""No object-level permissions: notifications has no HTTP endpoints. Kept for
module-shape uniformity — access to the NotificationLog is admin-only (see
admin.py), gated by Django admin's own staff permissions.
"""

from __future__ import annotations
