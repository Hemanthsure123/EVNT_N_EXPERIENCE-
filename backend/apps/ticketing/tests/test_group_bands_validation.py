"""The organiser's write path for group prices.

`group_bands` is a JSON column, so Postgres cannot express a CHECK comparing a
band's price to the tier's own `price_minor` — exactly the situation
`_validate_phase_schedule` was written for. This validation is therefore the
ONLY writer-side guard, and `pricing._eligible_bands` repeats the
never-overcharge floor at the charge path because a guard one writer honours is
not defense in depth.

The tests that carry weight are the MERGED-ROW ones. Three inputs the rule
depends on are independently editable and any of them may be absent from a
PATCH: the bands, the face price, and `max_per_order`. Validating submitted
bands against the STORED price is how "cut the price to 300" slips a 400 band
past the gate.
"""

from __future__ import annotations

import pytest

from apps.ticketing.exceptions import InvalidGroupBandsError

from .conftest import *  # noqa: F401,F403 — reuse the module's fixtures

FACE = 50_000  # ₹500


def _create(service, event, owner, bands, **kwargs):
    return service.create_ticket_type(
        event_id=event.id,
        actor_id=owner.id,
        name=kwargs.pop("name", "General"),
        price_minor=kwargs.pop("price_minor", FACE),
        quantity=kwargs.pop("quantity", 100),
        max_per_order=kwargs.pop("max_per_order", 10),
        group_bands=bands,
        **kwargs,
    )


@pytest.mark.django_db
class TestCreating:
    def test_a_valid_band_list_is_stored(self, ticketing_service, event, owner):
        tier = _create(
            ticketing_service,
            event,
            owner,
            [
                {"min_quantity": 2, "price_minor": 45_000},
                {"min_quantity": 4, "price_minor": 40_000},
            ],
        )

        assert [band["min_quantity"] for band in tier.group_bands] == [2, 4]

    def test_no_bands_is_the_normal_case(self, ticketing_service, event, owner):
        tier = _create(ticketing_service, event, owner, None)
        assert tier.group_bands == []

    def test_a_band_at_one_ticket_is_refused(self, ticketing_service, event, owner):
        """It is the face price wearing a label, and would apply to every
        single-ticket order."""
        with pytest.raises(InvalidGroupBandsError):
            _create(ticketing_service, event, owner, [{"min_quantity": 1, "price_minor": 40_000}])

    def test_a_band_above_the_face_price_is_refused(self, ticketing_service, event, owner):
        """A "discount" dearer than the normal price would OVERCHARGE every
        group that hit it."""
        with pytest.raises(InvalidGroupBandsError):
            _create(ticketing_service, event, owner, [{"min_quantity": 2, "price_minor": 60_000}])

    def test_a_band_equal_to_the_face_price_is_allowed(self, ticketing_service, event, owner):
        """Pointless but harmless, and refusing it would be a rule nobody
        asked for — an organiser mid-edit may well pass through it."""
        tier = _create(ticketing_service, event, owner, [{"min_quantity": 2, "price_minor": FACE}])
        assert tier.group_bands

    def test_repeated_or_decreasing_group_sizes_are_refused(self, ticketing_service, event, owner):
        """ "The largest band the order reaches" needs exactly one answer per
        order size."""
        with pytest.raises(InvalidGroupBandsError):
            _create(
                ticketing_service,
                event,
                owner,
                [
                    {"min_quantity": 4, "price_minor": 45_000},
                    {"min_quantity": 4, "price_minor": 40_000},
                ],
            )
        with pytest.raises(InvalidGroupBandsError):
            _create(
                ticketing_service,
                event,
                owner,
                [
                    {"min_quantity": 4, "price_minor": 45_000},
                    {"min_quantity": 2, "price_minor": 40_000},
                ],
            )

    def test_a_bigger_group_paying_more_per_head_is_refused(self, ticketing_service, event, owner):
        """That is not a group discount. It would make buying six cost more
        than buying four."""
        with pytest.raises(InvalidGroupBandsError):
            _create(
                ticketing_service,
                event,
                owner,
                [
                    {"min_quantity": 2, "price_minor": 40_000},
                    {"min_quantity": 4, "price_minor": 45_000},
                ],
            )

    def test_a_band_beyond_max_per_order_is_refused(self, ticketing_service, event, owner):
        """A band nobody can reach because the tier refuses that many tickets
        is a control that can never fire — and both numbers live on the same
        row, so it is checkable."""
        with pytest.raises(InvalidGroupBandsError):
            _create(
                ticketing_service,
                event,
                owner,
                [{"min_quantity": 8, "price_minor": 40_000}],
                max_per_order=4,
            )

    def test_more_than_five_bands_is_refused(self, ticketing_service, event, owner):
        with pytest.raises(InvalidGroupBandsError):
            _create(
                ticketing_service,
                event,
                owner,
                [{"min_quantity": size, "price_minor": FACE - size} for size in (2, 3, 4, 5, 6, 7)],
                max_per_order=10,
            )


@pytest.mark.django_db
class TestUpdatingAgainstTheMergedRow:
    """The half a serializer could not do, because it cannot see the stored
    row."""

    def test_bands_can_be_replaced_wholesale(self, ticketing_service, event, owner):
        tier = _create(
            ticketing_service, event, owner, [{"min_quantity": 2, "price_minor": 45_000}]
        )

        updated = ticketing_service.update_ticket_type(
            ticket_type_id=tier.id,
            actor_id=owner.id,
            expected_version=tier.version,
            changes={"group_bands": [{"min_quantity": 4, "price_minor": 30_000}]},
        )

        assert [band["min_quantity"] for band in updated.group_bands] == [4]

    def test_an_empty_list_CLEARS_them(self, ticketing_service, event, owner):
        """Wholesale replacement, like the phase schedule. If `[]` were read as
        "not supplied", removing your last group price would silently fail."""
        tier = _create(
            ticketing_service, event, owner, [{"min_quantity": 2, "price_minor": 45_000}]
        )

        updated = ticketing_service.update_ticket_type(
            ticket_type_id=tier.id,
            actor_id=owner.id,
            expected_version=tier.version,
            changes={"group_bands": []},
        )

        assert updated.group_bands == []

    def test_cutting_the_face_price_below_a_STORED_band_is_refused(
        self, ticketing_service, event, owner
    ):
        """THE TEST THIS FILE EXISTS FOR. The bands are not in this PATCH, so
        validating the submitted ones would check nothing — and the tier would
        be left with a band above its own price, which is an overcharge the
        charge path then has to defend against."""
        tier = _create(
            ticketing_service, event, owner, [{"min_quantity": 2, "price_minor": 45_000}]
        )

        with pytest.raises(InvalidGroupBandsError):
            ticketing_service.update_ticket_type(
                ticket_type_id=tier.id,
                actor_id=owner.id,
                expected_version=tier.version,
                changes={"price_minor": 30_000},
            )

    def test_lowering_max_per_order_below_a_STORED_band_is_refused(
        self, ticketing_service, event, owner
    ):
        """Same shape, other field: it would strand a band nobody can reach."""
        tier = _create(
            ticketing_service,
            event,
            owner,
            [{"min_quantity": 6, "price_minor": 40_000}],
            max_per_order=10,
        )

        with pytest.raises(InvalidGroupBandsError):
            ticketing_service.update_ticket_type(
                ticket_type_id=tier.id,
                actor_id=owner.id,
                expected_version=tier.version,
                changes={"max_per_order": 4},
            )

    def test_the_price_and_the_bands_can_move_together(self, ticketing_service, event, owner):
        """Cutting the face price is fine when the bands come down with it —
        which is exactly why the check has to see the merged row rather than
        either side alone."""
        tier = _create(
            ticketing_service, event, owner, [{"min_quantity": 2, "price_minor": 45_000}]
        )

        updated = ticketing_service.update_ticket_type(
            ticket_type_id=tier.id,
            actor_id=owner.id,
            expected_version=tier.version,
            changes={
                "price_minor": 30_000,
                "group_bands": [{"min_quantity": 2, "price_minor": 25_000}],
            },
        )

        assert updated.price_minor == 30_000
        assert updated.group_bands == [{"min_quantity": 2, "price_minor": 25_000}]

    def test_an_unrelated_edit_leaves_stored_bands_alone(self, ticketing_service, event, owner):
        """The merged-row check must not become a reason a name change fails."""
        tier = _create(
            ticketing_service, event, owner, [{"min_quantity": 2, "price_minor": 45_000}]
        )

        updated = ticketing_service.update_ticket_type(
            ticket_type_id=tier.id,
            actor_id=owner.id,
            expected_version=tier.version,
            changes={"name": "Standing"},
        )

        assert updated.name == "Standing"
        assert updated.group_bands == [{"min_quantity": 2, "price_minor": 45_000}]


@pytest.mark.django_db
def test_the_column_is_in_the_locked_field_set(ticketing_service, event, owner):
    """`_LOCK_FIELDS` drives a `.only()` on the row the reserve locks. A column
    the pricing rule reads but the lock does not fetch is DEFERRED, and Django
    re-fetches it mid-critical-section — which is the one thing holding the
    lock is meant to avoid.

    Asserted by reading the band off a locked row with no extra query rather
    than by inspecting the tuple, so the test fails for the reason that
    matters.
    """
    tier = _create(ticketing_service, event, owner, [{"min_quantity": 2, "price_minor": 45_000}])

    from django.db import transaction

    from apps.ticketing.repositories import TicketTypeRepository

    with transaction.atomic():
        locked = TicketTypeRepository().lock_for_update(tier.id)
        assert locked is not None
        # `group_bands` must already be loaded — touching a deferred field here
        # issues a second SELECT against the locked row.
        assert "group_bands" not in locked.get_deferred_fields()
        assert locked.group_bands == [{"min_quantity": 2, "price_minor": 45_000}]
