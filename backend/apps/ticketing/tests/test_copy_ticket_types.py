"""Cloning an event copies its tiers — ALL of each tier, group offers included.

`copy_ticket_types_to` copied the name, the price, the phases, the perks and
the sale window, and dropped `group_bands`. A promoter who cloned last month's
night got the same tiers at the same prices — and a four-person table that used
to cost less per head now cost full price, with nothing on either event saying
the offer had gone.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.events.repositories import EventRepository
from apps.ticketing.models import TicketType
from apps.ticketing.repositories import TicketTypeRepository

BANDS = [{"min_quantity": 4, "price_minor": 800}, {"min_quantity": 8, "price_minor": 700}]


@pytest.fixture
def second_event(organization):
    return EventRepository().create(
        organization_id=organization.id,
        title="Concert — the sequel",
        venue="Phoenix Arena",
        city="Mumbai",
        starts_at=timezone.now() + timedelta(days=60),
    )


@pytest.mark.django_db
def test_a_cloned_tier_keeps_its_group_offers(event, second_event, make_ticket_type):
    source = make_ticket_type(price_minor=1000)
    TicketType.objects.filter(pk=source.pk).update(group_bands=BANDS)

    TicketTypeRepository().copy_ticket_types_to(
        source_event_id=event.id, target_event_id=second_event.id
    )

    copy = TicketType.objects.get(event=second_event)
    assert copy.group_bands == BANDS
    assert copy.price_minor == 1000


@pytest.mark.django_db
def test_the_copy_owns_its_bands(event, second_event, make_ticket_type):
    """Copied BY VALUE: editing the clone's offer must not reach the original,
    which is what sharing one list object for the life of a process would do."""
    source = make_ticket_type(price_minor=1000)
    TicketType.objects.filter(pk=source.pk).update(group_bands=BANDS)

    TicketTypeRepository().copy_ticket_types_to(
        source_event_id=event.id, target_event_id=second_event.id
    )
    copy = TicketType.objects.get(event=second_event)
    copy.group_bands[0]["price_minor"] = 1
    copy.save(update_fields=["group_bands"])

    source.refresh_from_db()
    assert source.group_bands == BANDS


@pytest.mark.django_db
def test_a_tier_without_group_offers_copies_as_none(event, second_event, make_ticket_type):
    make_ticket_type(price_minor=1000)
    TicketTypeRepository().copy_ticket_types_to(
        source_event_id=event.id, target_event_id=second_event.id
    )
    assert TicketType.objects.get(event=second_event).group_bands == []
