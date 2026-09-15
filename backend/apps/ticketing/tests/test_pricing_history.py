"""A tier's pricing history: written inside the edit's own transaction, and
never inventing a past it cannot know.

Two properties carry the weight. An entry and its change commit or roll back
TOGETHER, so the log can never disagree with the price. And a tier that
predates the log gets exactly the history that is provable — its creation price
when it has never been edited, a baseline from "now" when it has — and nothing
back-dated past that.
"""

from __future__ import annotations

import pytest

from apps.ticketing.exceptions import StaleTicketTypeVersionError
from apps.ticketing.models import (
    PricingChangeKind,
    PricingFeature,
    PricingFeatureChange,
    TicketPriceChange,
    TicketType,
)

EARLY_BIRD = [{"name": "Early bird", "price_minor": 800, "quantity": 20}]
BANDS = [{"min_quantity": 4, "price_minor": 900}]

CREATED = PricingChangeKind.CREATED.value
EDITED = PricingChangeKind.EDITED.value
BASELINE = PricingChangeKind.BASELINE.value
EB = PricingFeature.EARLY_BIRD.value
GROUP = PricingFeature.GROUP_OFFERS.value


def _prices(tt: TicketType) -> list[tuple[int, str]]:
    return list(
        TicketPriceChange.objects.filter(ticket_type=tt)
        .order_by("changed_at", "id")
        .values_list("price_minor", "kind")
    )


def _features(tt: TicketType) -> list[tuple[str, bool, str]]:
    return list(
        PricingFeatureChange.objects.filter(ticket_type=tt)
        .order_by("changed_at", "feature")
        .values_list("feature", "enabled", "kind")
    )


def _create(service, event, owner, **extra) -> TicketType:
    return service.create_ticket_type(
        event_id=event.id,
        actor_id=owner.id,
        name="General Admission",
        price_minor=1000,
        quantity=50,
        **extra,
    )


def _edit(service, owner, tt: TicketType, changes: dict) -> TicketType:
    tt.refresh_from_db()
    return service.update_ticket_type(
        ticket_type_id=tt.id, actor_id=owner.id, expected_version=tt.version, changes=changes
    )


@pytest.mark.django_db
class TestANewTier:
    def test_records_its_price_at_its_own_creation(self, ticketing_service, event, owner):
        tt = _create(ticketing_service, event, owner)
        entry = TicketPriceChange.objects.get(ticket_type=tt)
        assert (entry.price_minor, entry.kind) == (1000, CREATED)
        # Dated at the tier's creation, so its first price period starts
        # exactly when the tier did.
        assert entry.changed_at == tt.created_at
        assert _features(tt) == []

    def test_records_the_features_it_is_born_with(self, ticketing_service, event, owner):
        tt = _create(ticketing_service, event, owner, phases=EARLY_BIRD, group_bands=BANDS)
        assert _features(tt) == [(EB, True, CREATED), (GROUP, True, CREATED)]


@pytest.mark.django_db
class TestAnEdit:
    def test_a_price_change_is_one_edited_entry(self, ticketing_service, event, owner):
        tt = _create(ticketing_service, event, owner)
        _edit(ticketing_service, owner, tt, {"price_minor": 1200})
        assert _prices(tt) == [(1000, CREATED), (1200, EDITED)]

    def test_an_edit_that_leaves_the_price_alone_writes_no_price_entry(
        self, ticketing_service, event, owner
    ):
        tt = _create(ticketing_service, event, owner)
        _edit(ticketing_service, owner, tt, {"quantity": 60})
        assert _prices(tt) == [(1000, CREATED)]

    def test_switching_early_bird_on_then_off_is_two_transitions(
        self, ticketing_service, event, owner
    ):
        tt = _create(ticketing_service, event, owner)
        _edit(ticketing_service, owner, tt, {"phases": EARLY_BIRD})
        _edit(ticketing_service, owner, tt, {"phases": []})
        assert _features(tt) == [(EB, True, EDITED), (EB, False, EDITED)]

    def test_replacing_one_schedule_with_another_is_not_a_transition(
        self, ticketing_service, event, owner
    ):
        """The log answers "did this tier have early bird", not "which one"."""
        tt = _create(ticketing_service, event, owner, phases=EARLY_BIRD)
        _edit(
            ticketing_service,
            owner,
            tt,
            {"phases": [{"name": "Super early", "price_minor": 700, "quantity": 10}]},
        )
        assert _features(tt) == [(EB, True, CREATED)]

    def test_group_offers_are_logged_the_same_way(self, ticketing_service, event, owner):
        tt = _create(ticketing_service, event, owner)
        _edit(ticketing_service, owner, tt, {"group_bands": BANDS})
        _edit(ticketing_service, owner, tt, {"group_bands": []})
        assert _features(tt) == [(GROUP, True, EDITED), (GROUP, False, EDITED)]

    def test_a_stale_edit_writes_nothing(self, ticketing_service, event, owner):
        """The entry lives in the edit's transaction — a 409 rolls it back."""
        tt = _create(ticketing_service, event, owner)
        with pytest.raises(StaleTicketTypeVersionError):
            ticketing_service.update_ticket_type(
                ticket_type_id=tt.id,
                actor_id=owner.id,
                expected_version=tt.version + 5,
                changes={"price_minor": 5000, "phases": EARLY_BIRD},
            )
        assert _prices(tt) == [(1000, CREATED)]
        assert _features(tt) == []


@pytest.mark.django_db
class TestATierThatPredatesTheLog:
    """`make_ticket_type` writes the row directly, so its tiers have no history
    — exactly the state of every tier that existed before the log did."""

    def test_a_never_edited_tier_has_its_creation_price_written_before_the_edit(
        self, ticketing_service, make_ticket_type, owner
    ):
        tt = make_ticket_type(price_minor=1000)
        assert _prices(tt) == []
        _edit(ticketing_service, owner, tt, {"price_minor": 1500})
        entries = list(TicketPriceChange.objects.filter(ticket_type=tt).order_by("changed_at"))
        assert [(entry.price_minor, entry.kind) for entry in entries] == [
            (1000, CREATED),
            (1500, EDITED),
        ]
        # version 1 means never edited, so the old price provably held from
        # the moment the tier was created — and is dated there.
        assert entries[0].changed_at == tt.created_at

    def test_an_already_edited_tier_gets_a_baseline_not_a_back_dated_creation(
        self, ticketing_service, make_ticket_type, owner
    ):
        tt = make_ticket_type(price_minor=1000)
        TicketType.objects.filter(pk=tt.pk).update(version=4)
        _edit(ticketing_service, owner, tt, {"quantity": 80})
        entry = TicketPriceChange.objects.get(ticket_type=tt)
        assert (entry.price_minor, entry.kind) == (1000, BASELINE)
        # "The price was 1000 from NOW" — its earlier past is unknown, and
        # nothing claims otherwise.
        assert entry.changed_at > tt.created_at

    def test_an_already_edited_tier_changing_its_price_needs_no_baseline(
        self, ticketing_service, make_ticket_type, owner
    ):
        tt = make_ticket_type(price_minor=1000)
        TicketType.objects.filter(pk=tt.pk).update(version=4)
        _edit(ticketing_service, owner, tt, {"price_minor": 1500})
        assert _prices(tt) == [(1500, EDITED)]

    def test_a_never_edited_tier_keeps_the_start_of_its_early_bird(
        self, ticketing_service, make_ticket_type, owner
    ):
        tt = make_ticket_type(phases=EARLY_BIRD)
        _edit(ticketing_service, owner, tt, {"phases": []})
        assert _features(tt) == [(EB, True, CREATED), (EB, False, EDITED)]

    def test_an_already_edited_tier_switching_a_feature_off_writes_only_the_switch(
        self, ticketing_service, make_ticket_type, owner
    ):
        """It was on since some unknown moment. The OFF is known; the ON is not,
        and the analytics read reports it as "since before the log began"."""
        tt = make_ticket_type(phases=EARLY_BIRD)
        TicketType.objects.filter(pk=tt.pk).update(version=3)
        _edit(ticketing_service, owner, tt, {"phases": []})
        assert _features(tt) == [(EB, False, EDITED)]
