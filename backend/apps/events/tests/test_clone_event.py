from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.events.models import Event, EventMedia, EventStatus
from apps.ticketing.models import SalePhase, TicketType


@pytest.mark.django_db
def test_clone_event_flow_success(api_client, owner, organization, make_event, token_for):
    source_event = make_event(
        title="Past Music Fest 2025",
        description="A great past music festival.",
        venue="Central Park",
        city="Mumbai",
        status=EventStatus.FINISHED,
        starts_at=timezone.now() - timedelta(days=30),
    )

    # Attach ticket type with sold counts & sale phase to source event
    tt = TicketType.objects.create(
        event=source_event,
        name="General Admission",
        price_minor=150000,
        quantity=100,
        sold=45,
        reserved=5,
    )
    SalePhase.objects.create(
        ticket_type=tt,
        name="Early Bird",
        price_minor=120000,
        position=0,
        quantity=50,
    )

    # Attach media to source event
    EventMedia.objects.create(
        event=source_event,
        kind="hero",
        url="https://example.com/banner.jpg",
        alt_text="Fest banner",
    )

    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(owner)}")

    # 1. Clone event via API
    resp = api_client.post(f"/api/v1/events/{source_event.id}/clone")
    assert resp.status_code == 201, resp.content
    cloned_data = resp.json()
    cloned_id = cloned_data["id"]

    assert cloned_id != str(source_event.id)
    assert cloned_data["status"] == EventStatus.DRAFT
    assert cloned_data["title"] == "Copy of Past Music Fest 2025"
    assert cloned_data["venue"] == "Central Park"
    assert cloned_data["city"] == "Mumbai"

    # Verify original event is untouched
    source_event.refresh_from_db()
    assert source_event.status == EventStatus.FINISHED

    # Verify cloned event in DB
    cloned_event = Event.objects.get(pk=cloned_id)
    assert cloned_event.status == EventStatus.DRAFT

    # Verify ticket types reset sold & reserved to 0
    cloned_tiers = TicketType.objects.filter(event=cloned_event)
    assert cloned_tiers.count() == 1
    cloned_tt = cloned_tiers.first()
    assert cloned_tt.name == "General Admission"
    assert cloned_tt.price_minor == 150000
    assert cloned_tt.quantity == 100
    assert cloned_tt.sold == 0
    assert cloned_tt.reserved == 0

    # Verify cloned sale phases
    phases = list(cloned_tt.phases.all())
    assert len(phases) == 1
    assert phases[0].name == "Early Bird"
    assert phases[0].price_minor == 120000

    # Verify media copied
    cloned_media = EventMedia.objects.filter(event=cloned_event)
    assert cloned_media.count() == 1
    assert cloned_media.first().url == "https://example.com/banner.jpg"


@pytest.mark.django_db
def test_clone_event_unauthorized(api_client, make_event, other_user, token_for):
    event = make_event(title="Owner's Event", status=EventStatus.LIVE)

    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(other_user)}")

    resp = api_client.post(f"/api/v1/events/{event.id}/clone")
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "not_event_owner"
