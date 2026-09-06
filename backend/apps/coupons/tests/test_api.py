"""The HTTP boundary: status codes, the error envelope, and the cache headers.

Side effects are proved in `test_services.py` and `test_redemption.py`. What is
asserted here is what an API test in this codebase asserts: the shape a client
sees.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.coupons.models import CouponKind

pytestmark = pytest.mark.django_db


@pytest.fixture
def authed(api_client, owner, token_for):
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(owner)}")
    return api_client


def coupons_url(organization) -> str:
    return f"/api/v1/organizations/{organization.id}/coupons"


class TestTheOrganizersList:
    def test_it_requires_a_session(self, api_client, organization):
        assert api_client.get(coupons_url(organization)).status_code == 401

    def test_it_lists_their_coupons_with_a_usage_count(self, authed, organization, make_coupon):
        make_coupon(code="SAVE20")

        response = authed.get(coupons_url(organization))

        assert response.status_code == 200
        row = response.json()["data"][0]
        assert row["code"] == "SAVE20"
        assert row["redeemed_count"] == 0

    def test_it_is_never_cached(self, authed, organization, make_coupon):
        """An owner's own commercial terms, on a per-user response."""
        make_coupon()
        response = authed.get(coupons_url(organization))
        assert response["Cache-Control"] == "private, no-store"

    def test_a_stranger_gets_a_404_rather_than_a_403(
        self, api_client, organization, stranger, token_for
    ):
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(stranger)}")
        response = api_client.get(coupons_url(organization))
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "coupon_not_found"


class TestCreating:
    def test_a_valid_coupon_is_created(self, authed, organization):
        response = authed.post(
            coupons_url(organization),
            {"code": "summer20", "kind": CouponKind.PERCENT, "value": 20},
            format="json",
        )

        assert response.status_code == 201
        body = response.json()
        assert body["code"] == "SUMMER20"
        assert body["redeemed_count"] == 0

    def test_a_duplicate_code_is_a_409_naming_the_code(self, authed, organization, make_coupon):
        make_coupon(code="SUMMER")
        response = authed.post(
            coupons_url(organization),
            {"code": "SUMMER", "kind": CouponKind.PERCENT, "value": 20},
            format="json",
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "coupon_code_taken"

    def test_contradictory_terms_are_a_422_with_a_specific_sentence(self, authed, organization):
        """The person reading this wrote the terms, so the message is the
        useful part — one code, and the specifics in the text."""
        response = authed.post(
            coupons_url(organization),
            {
                "code": "FLATCAP",
                "kind": CouponKind.FIXED,
                "value": 10_000,
                "max_discount_minor": 5_000,
            },
            format="json",
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_coupon"
        assert "percentage" in response.json()["error"]["message"]

    def test_a_field_the_serializer_can_judge_alone_is_refused_there(self, authed, organization):
        response = authed.post(
            coupons_url(organization),
            {"code": "AB", "kind": CouponKind.PERCENT, "value": 20},
            format="json",
        )
        assert response.status_code == 400


class TestEditing:
    def test_a_patch_changes_only_what_it_carries(self, authed, organization, make_coupon):
        coupon = make_coupon(visible_at_checkout=True)

        response = authed.patch(
            f"{coupons_url(organization)}/{coupon.id}", {"value": 25}, format="json"
        )

        assert response.status_code == 200
        assert response.json()["value"] == 25
        assert response.json()["visible_at_checkout"] is True

    def test_switching_a_coupon_off_is_a_patch_not_a_delete(
        self, authed, organization, make_coupon
    ):
        coupon = make_coupon()
        response = authed.patch(
            f"{coupons_url(organization)}/{coupon.id}", {"is_active": False}, format="json"
        )
        assert response.status_code == 200
        assert response.json()["is_active"] is False

    def test_an_unused_coupon_can_be_deleted(self, authed, organization, make_coupon):
        coupon = make_coupon()
        response = authed.delete(f"{coupons_url(organization)}/{coupon.id}")
        assert response.status_code == 204

    def test_another_organizations_coupon_is_a_404(
        self, api_client, rival_organization, stranger, token_for, make_coupon
    ):
        mine = make_coupon()
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(stranger)}")
        response = api_client.get(f"{coupons_url(rival_organization)}/{mine.id}")
        assert response.status_code == 404


class TestTheOffersList:
    def url(self, event) -> str:
        return f"/api/v1/events/{event.id}/offers"

    def test_it_is_public(self, api_client, event, make_coupon):
        make_coupon(code="PUBLIC20", visible_at_checkout=True)
        response = api_client.get(self.url(event))
        assert response.status_code == 200
        assert [row["code"] for row in response.json()["data"]] == ["PUBLIC20"]

    def test_a_PRIVATE_code_is_not_advertised(self, api_client, event, make_coupon):
        """The commonest use is a code given to a partner. A checkout that
        lists it hands the discount to everybody — the opposite of what the
        organizer bought."""
        make_coupon(code="PARTNER", visible_at_checkout=False)
        response = api_client.get(self.url(event))
        assert response.json()["data"] == []

    def test_it_carries_the_terms_and_NOT_the_limits(self, api_client, event, make_coupon):
        """Publishing "3 left" on a public read turns a promotion into a
        race."""
        make_coupon(code="PUBLIC20", visible_at_checkout=True, max_redemptions=3)
        row = api_client.get(self.url(event)).json()["data"][0]
        assert set(row) == {"id", "code", "kind", "value", "max_discount_minor", "expires_at"}

    def test_it_is_edge_cacheable(self, api_client, event, make_coupon):
        make_coupon(visible_at_checkout=True)
        response = api_client.get(self.url(event))
        assert "public" in response["Cache-Control"]
        assert "s-maxage" in response["Cache-Control"]
        assert response["ETag"]

    def test_a_matching_etag_answers_304(self, api_client, event, make_coupon):
        make_coupon(visible_at_checkout=True)
        first = api_client.get(self.url(event))
        again = api_client.get(self.url(event), HTTP_IF_NONE_MATCH=first["ETag"])
        assert again.status_code == 304

    def test_a_draft_event_has_no_offers_page(
        self, api_client, make_event, organization, make_coupon
    ):
        from apps.events.models import EventStatus

        make_coupon(visible_at_checkout=True)
        draft = make_event(org=organization, title="Unlisted", status=EventStatus.DRAFT)
        assert api_client.get(self.url(draft)).status_code == 404

    def test_an_event_with_no_offers_answers_an_empty_list(self, api_client, event):
        """Absent-not-empty is the CALLER's rule: the response is a list, and
        a checkout renders no offers section rather than an empty panel."""
        response = api_client.get(self.url(event))
        assert response.status_code == 200
        assert response.json()["data"] == []

    def test_a_scheduled_code_is_not_advertised_before_it_opens(
        self, api_client, event, make_coupon
    ):
        make_coupon(
            code="LATER", visible_at_checkout=True, starts_at=timezone.now() + timedelta(days=1)
        )
        assert api_client.get(self.url(event)).json()["data"] == []
