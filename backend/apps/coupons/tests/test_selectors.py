"""The advertised-offers read.

Its whole job is to not promise something the redemption path will refuse, so
the tests are about EXCLUSION: exhausted codes, scheduled codes, codes for
another event, codes for another tenant.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.coupons.selectors import public_offers_for_event

from .conftest import FACE

pytestmark = pytest.mark.django_db


def offers(event, organization):
    return public_offers_for_event(
        organization_id=organization.id, event_id=event.id, now=timezone.now()
    )


def test_an_exhausted_code_is_NOT_advertised(
    redemption_service, make_coupon, event, organization, buyer, make_booking
):
    """THE TEST THIS SELECTOR EXISTS FOR.

    Listing a code beside a field that answers "that code has been fully
    claimed" is the platform advertising a discount it will then refuse.
    """
    from django.db import transaction

    make_coupon(code="LASTONE", visible_at_checkout=True, max_redemptions=1)
    assert [offer.code for offer in offers(event, organization)] == ["LASTONE"]

    with transaction.atomic():
        redemption_service.redeem(
            event_id=event.id,
            user_id=buyer.id,
            booking_id=make_booking().id,
            code="LASTONE",
            subtotal_minor=FACE,
        )

    assert offers(event, organization) == []


def test_an_unlimited_code_stays_advertised_however_often_it_is_used(
    redemption_service, make_coupon, event, organization, buyer, make_booking
):
    from django.db import transaction

    make_coupon(code="ALWAYS", visible_at_checkout=True, max_per_user=5)
    with transaction.atomic():
        redemption_service.redeem(
            event_id=event.id,
            user_id=buyer.id,
            booking_id=make_booking().id,
            code="ALWAYS",
            subtotal_minor=FACE,
        )

    assert [offer.code for offer in offers(event, organization)] == ["ALWAYS"]


def test_it_is_NOT_filtered_by_who_is_asking(
    redemption_service, make_coupon, event, organization, buyer, make_booking
):
    """`max_per_user` is about the viewer, and applying it here would make this
    response per-user and therefore uncacheable — for a case that resolves into
    one clear sentence the moment they press Apply.
    """
    from django.db import transaction

    make_coupon(code="ONCEEACH", visible_at_checkout=True)
    with transaction.atomic():
        redemption_service.redeem(
            event_id=event.id,
            user_id=buyer.id,
            booking_id=make_booking().id,
            code="ONCEEACH",
            subtotal_minor=FACE,
        )

    assert [offer.code for offer in offers(event, organization)] == ["ONCEEACH"]


def test_a_code_scoped_to_another_event_is_not_listed(make_coupon, make_event, event, organization):
    other = make_event(org=organization, title="Rock Night")
    make_coupon(code="ROCKONLY", visible_at_checkout=True, event_id=other.id)

    assert offers(event, organization) == []
    assert [offer.code for offer in offers(other, organization)] == ["ROCKONLY"]


def test_an_org_wide_code_is_listed_on_every_event(make_coupon, make_event, event, organization):
    make_coupon(code="SEASON", visible_at_checkout=True)
    second = make_event(org=organization, title="Rock Night")

    assert [offer.code for offer in offers(event, organization)] == ["SEASON"]
    assert [offer.code for offer in offers(second, organization)] == ["SEASON"]


def test_an_expired_code_is_not_listed(coupon_service, make_coupon, event, organization, owner):
    coupon = make_coupon(code="OVER", visible_at_checkout=True)
    coupon_service.update_coupon(
        organization_id=organization.id,
        actor_id=owner.id,
        coupon_id=coupon.id,
        ends_at=timezone.now() - timedelta(seconds=1),
    )

    assert offers(event, organization) == []


def test_a_switched_off_code_is_not_listed(coupon_service, make_coupon, event, organization, owner):
    coupon = make_coupon(code="PAUSED", visible_at_checkout=True)
    coupon_service.update_coupon(
        organization_id=organization.id,
        actor_id=owner.id,
        coupon_id=coupon.id,
        is_active=False,
    )

    assert offers(event, organization) == []


def test_another_tenants_code_is_never_listed(
    coupon_service, rival_organization, stranger, event, organization
):
    coupon_service.create_coupon(
        organization_id=rival_organization.id,
        actor_id=stranger.id,
        code="THEIRS",
        kind="percent",
        value=50,
        visible_at_checkout=True,
    )

    assert offers(event, organization) == []


def test_no_offers_costs_no_aggregate_query(django_assert_num_queries, event, organization):
    """Most events have no advertised codes and this read sits on the
    checkout, so the common case is ONE statement — the usage aggregate is
    skipped entirely rather than run against an empty list."""
    with django_assert_num_queries(1):
        assert offers(event, organization) == []


def test_a_page_of_offers_costs_two_queries_however_many_there_are(
    django_assert_num_queries, make_coupon, event, organization
):
    """The list, then ONE aggregate for every row's usage. Asking per row is
    the N+1 the performance checklist exists to stop."""
    for index in range(5):
        make_coupon(code=f"OFFER{index}", visible_at_checkout=True, max_redemptions=10)

    with django_assert_num_queries(2):
        assert len(offers(event, organization)) == 5
