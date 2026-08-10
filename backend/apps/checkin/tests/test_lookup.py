"""POST /checkin/lookup — the read-only resolution of a QR token.

The whole point of this endpoint is a NEGATIVE: it must not change anything.
Before it existed, `verify_and_mark_used` was the only way to read a ticket at
all, so answering "has this person already gone in?" meant marking them as
having gone in — and the customer would then be refused at the real door with
`denied_already_used`, by an agent who was trying to help them.

So the load-bearing tests here are the ones that assert nothing happened: the
ticket is still ACTIVE afterwards, no `ScanLog` row was written, and a
subsequent real scan still admits. Everything else is contract detail.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from rest_framework.test import APIClient

from apps.booking.models import Ticket, TicketStatus
from apps.checkin.models import ScanLog

LOOKUP_URL = "/api/v1/checkin/lookup"
VERIFY_URL = "/api/v1/checkin/verify"


def _auth(client: APIClient, token_for, user) -> APIClient:
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(user)}")
    return client


def _lookup(client, event, token):
    return client.post(LOOKUP_URL, {"event_id": str(event.id), "qr_token": token}, format="json")


# ── The negative space: what a lookup must NOT do ────────────────────────────


@pytest.mark.django_db
def test_lookup_does_not_consume_the_ticket(api_client, token_for, issued_ticket, event, organizer):
    """THE test. A lookup must leave the ticket exactly as it found it."""
    _auth(api_client, token_for, organizer)

    resp = _lookup(api_client, event, issued_ticket.qr_token)

    assert resp.status_code == 200
    assert resp.data["found"] is True
    assert resp.data["would_admit"] is True

    issued_ticket.refresh_from_db()
    assert issued_ticket.status == TicketStatus.ACTIVE
    assert issued_ticket.used_at is None
    assert issued_ticket.gate == ""


@pytest.mark.django_db
def test_lookup_writes_no_scan_log_row(api_client, token_for, issued_ticket, event, organizer):
    """`ScanLog` is one row per scan that reached a real ticket, and its count
    must reconcile with the used-ticket total. A lookup is not a scan; logging
    one would inflate the audit trail with gate events that never happened."""
    _auth(api_client, token_for, organizer)

    _lookup(api_client, event, issued_ticket.qr_token)

    assert ScanLog.objects.count() == 0


@pytest.mark.django_db
def test_a_looked_up_ticket_still_admits_at_the_gate(
    api_client, token_for, issued_ticket, event, organizer
):
    """The end-to-end version of the bug this endpoint prevents: support looks
    the ticket up, then the holder presents it at the door and gets in."""
    _auth(api_client, token_for, organizer)

    _lookup(api_client, event, issued_ticket.qr_token)
    _lookup(api_client, event, issued_ticket.qr_token)  # twice, for good measure

    resp = api_client.post(
        VERIFY_URL,
        {"event_id": str(event.id), "qr_token": issued_ticket.qr_token, "gate": "North"},
        format="json",
    )
    assert resp.data["allowed"] is True
    assert resp.data["reason"] == "allowed"


@pytest.mark.django_db
def test_the_response_has_no_allowed_field(api_client, token_for, issued_ticket, event, organizer):
    """`LookupResult` deliberately has no `allowed`, so a client cannot render
    a lookup through the gate's admitted/denied component. `would_admit` is a
    hypothetical and is named as one."""
    _auth(api_client, token_for, organizer)

    resp = _lookup(api_client, event, issued_ticket.qr_token)

    assert "allowed" not in resp.data
    assert "would_admit" in resp.data


# ── The reason ladder must match the gate's, exactly ─────────────────────────


@pytest.mark.django_db
def test_lookup_reports_already_used_after_a_real_scan(
    api_client, token_for, issued_ticket, event, organizer
):
    """This is the question support is actually asking."""
    _auth(api_client, token_for, organizer)
    api_client.post(
        VERIFY_URL,
        {"event_id": str(event.id), "qr_token": issued_ticket.qr_token, "gate": "West"},
        format="json",
    )

    resp = _lookup(api_client, event, issued_ticket.qr_token)

    assert resp.data["found"] is True
    assert resp.data["would_admit"] is False
    assert resp.data["reason"] == "denied_already_used"
    # It carries WHEN and WHERE they went in — the actually useful part.
    assert resp.data["used_at"] is not None
    assert resp.data["gate"] == "West"


@pytest.mark.django_db
def test_lookup_reports_out_of_window_without_denying_forever(
    api_client, token_for, booking_service, buyer, future_event, make_tier, organizer
):
    from apps.checkin.tests.conftest import issue_one_ticket

    tier = make_tier(future_event)
    ticket = issue_one_ticket(booking_service, buyer=buyer, event=future_event, tier=tier)
    _auth(api_client, token_for, organizer)

    resp = _lookup(api_client, future_event, ticket.qr_token)

    assert resp.data["found"] is True
    assert resp.data["would_admit"] is False
    assert resp.data["reason"] == "denied_out_of_window"


@pytest.mark.django_db
def test_lookup_reports_a_voided_ticket(api_client, token_for, issued_ticket, event, organizer):
    Ticket.objects.filter(pk=issued_ticket.id).update(status=TicketStatus.VOID)
    _auth(api_client, token_for, organizer)

    resp = _lookup(api_client, event, issued_ticket.qr_token)

    assert resp.data["reason"] == "denied_not_active"
    assert resp.data["status"] == TicketStatus.VOID


@pytest.mark.django_db
def test_lookup_reports_the_wrong_event(
    api_client, token_for, issued_ticket, organization, organizer
):
    """A real ticket presented against a different event of the organizer's."""
    from apps.checkin.tests.conftest import _make_event

    other = _make_event(organization, starts_in=timedelta(hours=-1), ends_in=timedelta(hours=3))
    _auth(api_client, token_for, organizer)

    resp = _lookup(api_client, other, issued_ticket.qr_token)

    assert resp.data["found"] is True
    assert resp.data["reason"] == "denied_wrong_event"
    assert resp.data["would_admit"] is False


@pytest.mark.django_db
def test_lookup_rejects_a_forged_token_without_touching_the_database(
    api_client, token_for, event, organizer, django_assert_num_queries
):
    """ONE query — the JWT's own user lookup — and nothing else.

    The signature check runs before the event load and before the ticket load,
    so a forged token costs no application query at all. That is the same order
    `verify_and_mark_used` uses and for the same reason: an endpoint that takes
    an unauthenticated string must not let a bad one reach the database, or the
    cheapest thing to send becomes the most expensive thing to serve.
    """
    _auth(api_client, token_for, organizer)

    with django_assert_num_queries(1):
        resp = _lookup(api_client, event, "v1.forged.signature")

    assert resp.status_code == 200
    assert resp.data["found"] is False
    assert resp.data["reason"] == "denied_invalid"
    assert resp.data["ticket_id"] is None


# ── Authorization is identical to the gate's, not laxer ──────────────────────


@pytest.mark.django_db
def test_a_stranger_cannot_look_up_a_ticket(
    api_client, token_for, issued_ticket, event, other_user
):
    """A lookup exposes the attendee's name, so it cannot be laxer than the
    scan it stands in for."""
    _auth(api_client, token_for, other_user)

    resp = _lookup(api_client, event, issued_ticket.qr_token)

    assert resp.status_code == 403
    assert resp.data["error"]["code"] == "not_allowed_to_check_in"


@pytest.mark.django_db
def test_anonymous_is_rejected(api_client, issued_ticket, event):
    resp = _lookup(api_client, event, issued_ticket.qr_token)
    assert resp.status_code == 401


@pytest.mark.django_db
def test_an_unknown_event_is_404(api_client, token_for, issued_ticket, organizer):
    import uuid

    _auth(api_client, token_for, organizer)
    resp = api_client.post(
        LOOKUP_URL,
        {"event_id": str(uuid.uuid4()), "qr_token": issued_ticket.qr_token},
        format="json",
    )
    assert resp.status_code == 404
    assert resp.data["error"]["code"] == "event_not_found"


# ── Contract detail ──────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_the_response_is_never_shared_cached(
    api_client, token_for, issued_ticket, event, organizer
):
    _auth(api_client, token_for, organizer)
    resp = _lookup(api_client, event, issued_ticket.qr_token)
    assert resp["Cache-Control"] == "private, no-store"


@pytest.mark.django_db
def test_lookup_carries_the_event_title_and_tier(
    api_client, token_for, issued_ticket, event, organizer, tier
):
    """A support agent on a phone call needs the event's NAME, not its uuid."""
    _auth(api_client, token_for, organizer)

    resp = _lookup(api_client, event, issued_ticket.qr_token)

    assert resp.data["event_title"] == event.title
    assert resp.data["ticket_type"] == tier.name


@pytest.mark.django_db
def test_lookup_is_one_query_beyond_auth_and_the_event(
    api_client, token_for, issued_ticket, event, organizer, django_assert_num_queries
):
    """Auth + event (authorization) + the ticket. `get_for_lookup` joins the
    booking, event and tier in ONE query — an N+1 here would be three."""
    _auth(api_client, token_for, organizer)

    with django_assert_num_queries(3):
        _lookup(api_client, event, issued_ticket.qr_token)


@pytest.mark.django_db
def test_the_gate_and_the_lookup_never_disagree(
    api_client, token_for, booking_service, buyer, event, make_tier, organizer
):
    """If these two answered differently, support would confidently tell
    somebody they were fine and the door would refuse them. The ladders are
    kept parallel in `services.py`; this pins that they stay so.
    """
    from apps.checkin.tests.conftest import issue_one_ticket

    _auth(api_client, token_for, organizer)
    tier = make_tier(event, name="Parallel")

    for _ in range(3):
        ticket = issue_one_ticket(booking_service, buyer=buyer, event=event, tier=tier)
        looked = _lookup(api_client, event, ticket.qr_token)
        scanned = api_client.post(
            VERIFY_URL,
            {"event_id": str(event.id), "qr_token": ticket.qr_token, "gate": "G"},
            format="json",
        )
        # The lookup predicted the scan's verdict, and its reason string is the
        # same vocabulary.
        assert looked.data["would_admit"] == scanned.data["allowed"]
        assert looked.data["reason"] == scanned.data["reason"]

        # ...and now that it IS used, the lookup agrees with the second scan too.
        looked_again = _lookup(api_client, event, ticket.qr_token)
        assert looked_again.data["reason"] == "denied_already_used"


@pytest.mark.django_db
def test_an_admin_may_look_up_any_events_ticket(
    api_client, token_for, issued_ticket, event, other_user
):
    """Staff see everything — the console's booking lookup depends on this."""
    other_user.is_staff = True
    other_user.save(update_fields=["is_staff"])
    _auth(api_client, token_for, other_user)

    resp = _lookup(api_client, event, issued_ticket.qr_token)

    assert resp.status_code == 200
    assert resp.data["found"] is True


@pytest.mark.django_db
def test_attendee_name_is_null_rather_than_blank_when_the_buyer_is_going(
    api_client, token_for, issued_ticket, event, organizer
):
    """Empty string is the stored default and means "the buyer is going".
    Normalised to null so the client renders the buyer rather than an empty row
    labelled "Attendee"."""
    _auth(api_client, token_for, organizer)

    resp = _lookup(api_client, event, issued_ticket.qr_token)

    assert issued_ticket.attendee_name == ""
    assert resp.data["attendee_name"] is None
    assert resp.data["gate"] is None
