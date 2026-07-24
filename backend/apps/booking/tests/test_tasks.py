from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.booking.models import Booking, BookingStatus
from apps.booking.tasks import release_expired
from apps.ticketing.repositories import TicketTypeRepository


@pytest.mark.django_db
def test_release_expired_task_sweeps_lapsed_holds(booking_service, buyer, event, make_tier):
    # The task uses the DI-built service; create the hold through the fixture
    # service (same DB), then age it out.
    tier = make_tier(quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 4}]
    )
    Booking.objects.filter(pk=result.booking.id).update(
        hold_expires_at=timezone.now() - timedelta(minutes=1)
    )

    release_expired({})

    tt = TicketTypeRepository().get_active_by_id(tier.id)
    assert tt is not None
    assert tt.reserved == 0
    result.booking.refresh_from_db()
    assert result.booking.status == BookingStatus.EXPIRED
