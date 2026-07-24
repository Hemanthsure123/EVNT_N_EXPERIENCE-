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
    assert body["booking"]["total_amount"] == 100000
    assert body["payment"]["order_id"].startswith("fake_order_")
    assert body["payment"]["amount_minor"] == 100000
    assert body["payment"]["currency"] == "INR"
    assert resp.headers["Cache-Control"] == "private, no-store"


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
    assert resp.headers["Cache-Control"] == "private, no-store"


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

    # auth lookup + (booking+event) + (items+tier prefetch). No N+1 on items.
    with django_assert_num_queries(3):
        assert authed_client.get(url).status_code == 200


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
