from __future__ import annotations

import pytest

from apps.booking.models import Booking, BookingStatus


def _create_via_service(booking_service, buyer, event, tier, quantity=2):
    return booking_service.create_booking(
        user_id=buyer.id,
        event_id=event.id,
        items=[{"ticket_type_id": tier.id, "quantity": quantity}],
    )


# --- POST /bookings --------------------------------------------------------


@pytest.mark.django_db
def test_create_booking_returns_201_with_payment_info(authed_client, event, make_tier):
    tier = make_tier(price_minor=50000, quantity=100)

    resp = authed_client.post(
        "/api/v1/bookings",
        {"event_id": str(event.id), "items": [{"ticket_type_id": str(tier.id), "quantity": 2}]},
        format="json",
    )

    assert resp.status_code == 201
    body = resp.json()
    assert body["booking"]["status"] == "reserved"
    # 2 x 50000 tickets + 1% platform fee, which is ADDED to the charge rather
    # than deducted from the organizer's share. The payment order must be for
    # the same number — a checkout that charges a different amount from the one
    # the booking records is what the webhook's amount check exists to catch.
    assert body["booking"]["total_amount"] == 101000
    assert body["booking"]["platform_fee"] == 1000
    assert body["booking"]["donation"] == 0
    assert body["payment"]["order_id"].startswith("fake_order_")
    assert body["payment"]["amount_minor"] == 101000
    assert body["payment"]["currency"] == "INR"
    assert resp.headers["Cache-Control"] == "private, no-store"


@pytest.mark.django_db
def test_create_booking_names_the_provider_and_withholds_a_mismatched_key(
    authed_client, event, make_tier, settings
):
    """The response has to say which provider actually created the order.

    A leftover `RAZORPAY_KEY_ID` alongside `PAYMENTS_BACKEND=fake` used to be
    handed to the frontend anyway, whose only signal for "can a real checkout
    happen" was whether that string was empty — so the funnel opened Razorpay
    Checkout with a `fake_order_…` id, which Razorpay rejects. The key belongs
    to the provider or it is not sent.
    """
    settings.RAZORPAY_KEY_ID = "rzp_test_leftover_from_another_deploy"
    tier = make_tier(price_minor=50000, quantity=100)

    resp = authed_client.post(
        "/api/v1/bookings",
        {"event_id": str(event.id), "items": [{"ticket_type_id": str(tier.id), "quantity": 1}]},
        format="json",
    )

    body = resp.json()
    assert body["payment"]["provider"] == "fake"
    assert body["payment"]["key_id"] == ""


@pytest.mark.django_db
def test_create_booking_requires_authentication(api_client, event, make_tier):
    tier = make_tier()
    resp = api_client.post(
        "/api/v1/bookings",
        {"event_id": str(event.id), "items": [{"ticket_type_id": str(tier.id), "quantity": 1}]},
        format="json",
    )
    assert resp.status_code == 401


@pytest.mark.django_db
def test_create_booking_sold_out_returns_409(authed_client, event, make_tier):
    tier = make_tier(quantity=1)

    resp = authed_client.post(
        "/api/v1/bookings",
        {"event_id": str(event.id), "items": [{"ticket_type_id": str(tier.id), "quantity": 5}]},
        format="json",
    )

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "sold_out"


@pytest.mark.django_db
def test_create_booking_with_empty_items_is_400(authed_client, event):
    resp = authed_client.post(
        "/api/v1/bookings", {"event_id": str(event.id), "items": []}, format="json"
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_create_booking_idempotency_key_returns_same_booking(authed_client, event, make_tier):
    tier = make_tier(quantity=100)
    payload = {
        "event_id": str(event.id),
        "items": [{"ticket_type_id": str(tier.id), "quantity": 2}],
    }

    first = authed_client.post(
        "/api/v1/bookings", payload, format="json", HTTP_IDEMPOTENCY_KEY="dup-key-1"
    )
    second = authed_client.post(
        "/api/v1/bookings", payload, format="json", HTTP_IDEMPOTENCY_KEY="dup-key-1"
    )

    assert first.status_code == second.status_code == 201
    assert first.json()["booking"]["id"] == second.json()["booking"]["id"]
    assert Booking.objects.count() == 1


# --- GET /bookings/{id} ----------------------------------------------------


@pytest.mark.django_db
def test_get_booking_detail_returns_items(authed_client, booking_service, buyer, event, make_tier):
    tier = make_tier(name="Gold", price_minor=50000, quantity=100)
    result = _create_via_service(booking_service, buyer, event, tier)

    resp = authed_client.get(f"/api/v1/bookings/{result.booking.id}")

    assert resp.status_code == 200
    body = resp.json()
    assert body["event_title"] == "Headline Show"
    assert len(body["items"]) == 1
    assert body["items"][0]["ticket_type_name"] == "Gold"
    assert body["items"][0]["unit_price"] == 50000
    assert body["items"][0]["phase_name"] is None  # billed at the face price
    assert resp.headers["Cache-Control"] == "private, no-store"


@pytest.mark.django_db
def test_get_booking_detail_labels_the_phase_a_line_was_billed_under(
    authed_client, booking_service, buyer, event, make_tier
):
    """The funnel labels a line "Gold — Early bird", so the phase that priced it
    has to reach the response alongside the price it produced."""
    tier = make_tier(
        name="Gold",
        price_minor=50000,
        quantity=100,
        phases=[{"name": "Early bird", "price_minor": 30000, "quantity": 10}],
    )
    result = _create_via_service(booking_service, buyer, event, tier)

    resp = authed_client.get(f"/api/v1/bookings/{result.booking.id}")

    assert resp.status_code == 200
    item = resp.json()["items"][0]
    assert item["unit_price"] == 30000
    assert item["phase_name"] == "Early bird"


@pytest.mark.django_db
def test_get_booking_detail_by_non_owner_is_403(
    api_client, booking_service, buyer, other_user, event, make_tier, token_for
):
    tier = make_tier(quantity=100)
    result = _create_via_service(booking_service, buyer, event, tier)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(other_user)}")

    resp = api_client.get(f"/api/v1/bookings/{result.booking.id}")

    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "not_booking_owner"


@pytest.mark.django_db
def test_get_booking_detail_query_budget(
    authed_client, booking_service, buyer, event, make_tier, django_assert_num_queries
):
    tier = make_tier(quantity=100)
    result = _create_via_service(booking_service, buyer, event, tier)
    url = f"/api/v1/bookings/{result.booking.id}"

    # auth lookup + (booking+event) + (items+tier prefetch) + (tickets+tier
    # prefetch). No N+1 on either collection.
    with django_assert_num_queries(4):
        assert authed_client.get(url).status_code == 200


@pytest.mark.django_db
def test_get_booking_detail_shows_who_each_ticket_is_for(
    authed_client, booking_service, buyer, event, make_tier
):
    tier = make_tier(name="Gold", quantity=100)
    result = _create_via_service(booking_service, buyer, event, tier, quantity=2)
    tickets = booking_service.confirm_booking(
        booking_id=result.booking.id, payment_ref="pay_1"
    ).tickets
    booking_service.assign_attendees(
        booking_id=result.booking.id,
        actor_id=buyer.id,
        assignments=[{"ticket_id": tickets[0].id, "name": "Asha Rao", "email": "asha@example.com"}],
    )

    body = authed_client.get(f"/api/v1/bookings/{result.booking.id}").json()

    rows = {row["id"]: row for row in body["tickets"]}
    assert rows[str(tickets[0].id)]["attendee_name"] == "Asha Rao"
    assert rows[str(tickets[0].id)]["attendee_email"] == "asha@example.com"
    # Blank on the buyer's own ticket — the default, and it stays valid.
    assert rows[str(tickets[1].id)]["attendee_name"] == ""


# --- POST /bookings/{id}/attendees -----------------------------------------


def _paid_tickets(booking_service, buyer, event, make_tier, quantity=3):
    tier = make_tier(name="Gold", quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id,
        event_id=event.id,
        items=[{"ticket_type_id": tier.id, "quantity": quantity}],
    )
    outcome = booking_service.confirm_booking(booking_id=result.booking.id, payment_ref="pay_1")
    return result.booking, outcome.tickets


@pytest.mark.django_db
def test_assign_attendees_returns_the_updated_ticket_list(
    authed_client, booking_service, buyer, event, make_tier
):
    booking, tickets = _paid_tickets(booking_service, buyer, event, make_tier, quantity=2)

    resp = authed_client.post(
        f"/api/v1/bookings/{booking.id}/attendees",
        {
            "assignments": [
                {"ticket_id": str(tickets[0].id), "name": "Asha Rao", "email": "asha@example.com"}
            ]
        },
        format="json",
    )

    assert resp.status_code == 200
    rows = {row["id"]: row for row in resp.json()["tickets"]}
    assert len(rows) == 2
    assert rows[str(tickets[0].id)]["attendee_email"] == "asha@example.com"
    assert resp.headers["Cache-Control"] == "private, no-store"


@pytest.mark.django_db
def test_assign_attendees_by_non_owner_is_403(
    api_client, booking_service, buyer, other_user, event, make_tier, token_for
):
    booking, tickets = _paid_tickets(booking_service, buyer, event, make_tier, quantity=1)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(other_user)}")

    resp = api_client.post(
        f"/api/v1/bookings/{booking.id}/attendees",
        {
            "assignments": [
                {"ticket_id": str(tickets[0].id), "name": "Thief", "email": "t@example.com"}
            ]
        },
        format="json",
    )

    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "not_booking_owner"


@pytest.mark.django_db
def test_assign_attendees_with_a_foreign_ticket_is_400(
    authed_client, booking_service, buyer, other_user, event, make_tier
):
    booking, _mine = _paid_tickets(booking_service, buyer, event, make_tier, quantity=1)
    tier = make_tier(name="Silver", quantity=100)
    theirs = booking_service.create_booking(
        user_id=other_user.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 1}]
    )
    stolen = booking_service.confirm_booking(
        booking_id=theirs.booking.id, payment_ref="pay_theirs"
    ).tickets[0]

    resp = authed_client.post(
        f"/api/v1/bookings/{booking.id}/attendees",
        {
            "assignments": [
                {"ticket_id": str(stolen.id), "name": "Thief", "email": "thief@example.com"}
            ]
        },
        format="json",
    )

    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "invalid_attendee_assignments"


@pytest.mark.django_db
def test_assign_attendees_on_an_unpaid_booking_is_409(
    authed_client, booking_service, buyer, event, make_tier
):
    tier = make_tier(quantity=100)
    result = _create_via_service(booking_service, buyer, event, tier, quantity=1)

    resp = authed_client.post(
        f"/api/v1/bookings/{result.booking.id}/attendees",
        {
            "assignments": [
                {"ticket_id": str(result.booking.id), "name": "Asha", "email": "a@example.com"}
            ]
        },
        format="json",
    )

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "booking_not_assignable"


@pytest.mark.django_db
def test_assign_attendees_requires_authentication(api_client, event):
    resp = api_client.post(
        f"/api/v1/bookings/{event.id}/attendees", {"assignments": []}, format="json"
    )
    assert resp.status_code == 401


# --- POST /bookings/{id}/cancel --------------------------------------------


@pytest.mark.django_db
def test_cancel_booking_returns_200_and_releases(
    authed_client, booking_service, buyer, event, make_tier
):
    tier = make_tier(quantity=100)
    result = _create_via_service(booking_service, buyer, event, tier, quantity=3)

    resp = authed_client.post(f"/api/v1/bookings/{result.booking.id}/cancel", format="json")

    assert resp.status_code == 200
    assert resp.json()["status"] == "cancelled"
    result.booking.refresh_from_db()
    assert result.booking.status == BookingStatus.CANCELLED


# --- GET /me/tickets -------------------------------------------------------


@pytest.mark.django_db
def test_my_tickets_lists_issued_tickets(authed_client, booking_service, buyer, event, make_tier):
    tier = make_tier(quantity=100)
    result = _create_via_service(booking_service, buyer, event, tier, quantity=2)
    booking_service.confirm_booking(booking_id=result.booking.id, payment_ref="pay_1")

    resp = authed_client.get("/api/v1/me/tickets")

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data) == 2
    assert data[0]["event_title"] == "Headline Show"
    assert data[0]["qr_token"]
    # Which booking issued it — how the confirmation screen shows the buyer the
    # tickets they just paid for rather than their whole account's.
    assert data[0]["booking_id"] == str(result.booking.id)
    assert resp.headers["Cache-Control"] == "private, no-store"


@pytest.mark.django_db
def test_my_tickets_requires_authentication(api_client):
    assert api_client.get("/api/v1/me/tickets").status_code == 401


@pytest.mark.django_db
def test_my_tickets_only_shows_mine(
    authed_client, booking_service, buyer, other_user, event, make_tier
):
    tier = make_tier(quantity=100)
    mine = _create_via_service(booking_service, buyer, event, tier, quantity=1)
    booking_service.confirm_booking(booking_id=mine.booking.id, payment_ref="pay_mine")
    theirs = booking_service.create_booking(
        user_id=other_user.id,
        event_id=event.id,
        items=[{"ticket_type_id": tier.id, "quantity": 1}],
    )
    booking_service.confirm_booking(booking_id=theirs.booking.id, payment_ref="pay_theirs")

    resp = authed_client.get("/api/v1/me/tickets")

    assert len(resp.json()["data"]) == 1  # only the buyer's ticket


@pytest.mark.django_db
def test_my_tickets_query_budget(
    authed_client, booking_service, buyer, event, make_tier, django_assert_num_queries
):
    tier = make_tier(quantity=100)
    result = _create_via_service(booking_service, buyer, event, tier, quantity=3)
    booking_service.confirm_booking(booking_id=result.booking.id, payment_ref="pay_1")

    # auth lookup + one ticket query (tier + event joined). No N+1 across tickets.
    with django_assert_num_queries(2):
        assert authed_client.get("/api/v1/me/tickets").status_code == 200
