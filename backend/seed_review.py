"""A finished event the probe user attended, so the review flow is reachable.

Moves an existing paid booking's event into the past and scans one ticket, so
the probe account has exactly one pending review and one verified attendance.
"""

import os
from datetime import timedelta

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.cloud")
django.setup()

from django.contrib.auth import get_user_model  # noqa: E402
from django.utils import timezone  # noqa: E402

from apps.booking.models import Booking, BookingStatus, Ticket, TicketStatus  # noqa: E402
from config.di import build_review_service  # noqa: E402

User = get_user_model()
user = User.objects.filter(email="probe.tickets@example.com").first()
if user is None:
    raise SystemExit("probe user missing")

booking = (
    Booking.objects.filter(user=user, status=BookingStatus.PAID)
    .select_related("event")
    .order_by("-created_at")
    .first()
)
if booking is None:
    raise SystemExit("probe user has no paid booking")

event = booking.event
now = timezone.now()
event.starts_at = now - timedelta(days=1, hours=3)
event.ends_at = now - timedelta(days=1)
event.save(update_fields=["starts_at", "ends_at"])

# One ticket scanned, so the verified-attendee badge is exercised for real.
first = Ticket.objects.filter(booking=booking).first()
if first:
    Ticket.objects.filter(id=first.id).update(status=TicketStatus.USED)

print("event:", event.title, event.id)
print("ended:", event.ends_at)

service = build_review_service()
print("eligibility:", service.check_eligibility(event_id=event.id, user_id=user.id))
print("pending:", [row.title for row in service.pending_for_user(user_id=user.id)])
