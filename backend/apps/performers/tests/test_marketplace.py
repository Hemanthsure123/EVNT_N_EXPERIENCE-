"""The Hire a Band marketplace.

Four things carry the weight here and are tested first:

1. **A profile that has not been approved is invisible.** The moderation gate
   is what makes this a curated marketplace rather than an open listing board,
   and every public queryset filters on LIVE.
2. **A brief has exactly one winner.** Accepting a quote must close the
   request, decline every other quote and record the booking together — a
   customer with two accepted quotes has promised the date twice.
3. **One quote per performer per request**, enforced by the DATABASE, because
   a check-then-insert leaves a window two concurrent submissions both pass.
4. **A brief tells a performer nothing about the customer.** A lead is a job to
   bid on; the customer's identity is not the performer's to have until hired.
"""

from __future__ import annotations

import datetime as dt

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.repositories import UserRepository
from apps.organizations.repositories import OrganizationRepository
from apps.performers.models import (
    BookingRequest,
    Occasion,
    PerformerStatus,
    PerformerType,
    QuoteStatus,
    RequestStatus,
)
from apps.performers.repositories import (
    BookingRequestRepository,
    PerformerMediaRepository,
    PerformerRepository,
    QuoteRepository,
)
from apps.performers.services import (
    MarketplaceService,
    PerformerModerationService,
    PerformerService,
    readiness_problems,
)
from core.adapters.local.local_storage import LocalStorageAdapter
from core.errors import InvalidInputError


def authed(user) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def service() -> PerformerService:
    # Real repositories and the LOCAL storage adapter, never `config.di` — a
    # unit test must not depend on settings-driven backend selection.
    return PerformerService(
        performers=PerformerRepository(),
        media=PerformerMediaRepository(),
        organizations=OrganizationRepository(),
        storage=LocalStorageAdapter(),
    )


@pytest.fixture
def moderation() -> PerformerModerationService:
    return PerformerModerationService(performers=PerformerRepository(), users=UserRepository())


@pytest.fixture
def marketplace() -> MarketplaceService:
    return MarketplaceService(
        requests=BookingRequestRepository(),
        quotes=QuoteRepository(),
        performers=PerformerRepository(),
    )


# ------------------------------------------------------------- visibility


@pytest.mark.django_db
class TestPublicVisibility:
    @pytest.mark.parametrize(
        "status",
        [
            PerformerStatus.DRAFT,
            PerformerStatus.PENDING_REVIEW,
            PerformerStatus.REJECTED,
            PerformerStatus.PAUSED,
            PerformerStatus.ARCHIVED,
        ],
    )
    def test_only_a_live_profile_is_public(self, make_performer, status):
        """The moderation gate, at the query level. An unapproved act is
        invisible by construction rather than by a filter somebody has to
        remember to add."""
        make_performer(status=status)
        assert list(PerformerRepository().list_published()) == []

    def test_a_live_profile_is_public(self, make_performer):
        performer = make_performer()
        assert [row.id for row in PerformerRepository().list_published()] == [performer.id]

    def test_the_detail_endpoint_404s_for_an_unapproved_profile(self, make_performer):
        """A draft, a rejection and a nonexistent id are ALL 404 — a distinct
        response would confirm the profile exists to anyone guessing ids."""
        performer = make_performer(status=PerformerStatus.PENDING_REVIEW)
        response = APIClient().get(f"/api/v1/performers/{performer.id}")
        assert response.status_code == 404

    def test_browsing_needs_no_account(self, make_performer):
        """The whole point of a marketplace is that people find it before they
        register."""
        make_performer()
        assert APIClient().get("/api/v1/performers").status_code == 200

    def test_the_public_browse_is_edge_cacheable(self, make_performer):
        make_performer()
        response = APIClient().get("/api/v1/performers")
        assert "s-maxage" in response["Cache-Control"]
        assert "private" not in response["Cache-Control"]

    def test_the_owner_list_is_never_edge_cacheable(self, owner, make_performer):
        make_performer(status=PerformerStatus.DRAFT)
        response = authed(owner).get("/api/v1/me/performers")
        assert response["Cache-Control"] == "private, no-store"


# ---------------------------------------------------------------- search


@pytest.mark.django_db
class TestSearch:
    def test_a_stage_name_is_found(self, make_performer):
        make_performer(stage_name="Sitar Collective")
        make_performer(stage_name="The Brass Band")
        rows = PerformerRepository().list_published(search="sitar")
        assert [row.stage_name for row in rows] == ["Sitar Collective"]

    def test_a_genre_is_searchable(self, make_performer):
        """People arrive by genre far more than by name, so the trigger feeds
        the JSON array into the vector."""
        make_performer(stage_name="Nameless", genres=["qawwali"])
        rows = PerformerRepository().list_published(search="qawwali")
        assert [row.stage_name for row in rows] == ["Nameless"]

    def test_the_vector_refreshes_when_the_name_changes(self, make_performer):
        """The trigger is `BEFORE UPDATE OF`, so an edit to a source column
        recomputes it with zero application code."""
        performer = make_performer(stage_name="Old Name")
        performer.stage_name = "Brand New Name"
        performer.save(update_fields=["stage_name"])

        rows = PerformerRepository().list_published(search="brand new")
        assert [row.id for row in rows] == [performer.id]

    def test_arbitrary_input_does_not_raise(self, make_performer):
        """`websearch` parsing never raises on user input, unlike the default
        tsquery parser — so no sanitising is needed at the boundary."""
        make_performer()
        assert list(PerformerRepository().list_published(search='"unclosed AND ((')) == []


# --------------------------------------------------------------- filters


@pytest.mark.django_db
class TestFilters:
    def test_budget_includes_acts_that_price_on_ask(self, make_performer):
        """An act with no listed price is INCLUDED rather than filtered out.
        Hiding them from every budgeted search would quietly remove the
        expensive end of the market from the marketplace."""
        priced = make_performer(stage_name="Priced", base_price_minor=5_000_00)
        on_ask = make_performer(stage_name="On ask", base_price_minor=None)
        make_performer(stage_name="Too dear", base_price_minor=90_000_00)

        rows = PerformerRepository().list_published(budget_max_minor=10_000_00)

        assert {row.id for row in rows} == {priced.id, on_ask.id}

    def test_genre_and_language_filters_match_the_json_arrays(self, make_performer):
        match = make_performer(genres=["jazz"], languages=["Tamil"])
        make_performer(stage_name="Other", genres=["rock"], languages=["English"])

        assert [row.id for row in PerformerRepository().list_published(genre="jazz")] == [match.id]
        assert [row.id for row in PerformerRepository().list_published(language="Tamil")] == [
            match.id
        ]

    def test_verified_only_uses_the_organisations_own_level(self, make_performer, organization):
        """Verification is reused wholesale rather than duplicated — it is the
        same legal entity being vouched for."""
        make_performer()
        assert list(PerformerRepository().list_published(verified_only=True)) == []

        organization.verified_level = "verified"
        organization.save(update_fields=["verified_level"])
        assert len(list(PerformerRepository().list_published(verified_only=True))) == 1

    def test_featured_sorts_first(self, make_performer):
        make_performer(stage_name="Ordinary")
        star = make_performer(stage_name="Star", is_featured=True)
        rows = list(PerformerRepository().list_published())
        assert rows[0].id == star.id

    def test_facets_are_derived_from_live_rows_only(self, make_performer):
        """A genre nobody performs must never appear as a filter that returns
        nothing."""
        from apps.performers.selectors import get_marketplace_facets

        make_performer(city="Mumbai", genres=["jazz"], languages=["Hindi"])
        make_performer(status=PerformerStatus.DRAFT, city="Pune", genres=["metal"])

        facets = get_marketplace_facets()

        assert facets["cities"] == ["Mumbai"]
        assert facets["genres"] == ["jazz"]
        assert "metal" not in facets["genres"]


# ------------------------------------------------------------- ownership


@pytest.mark.django_db
class TestOwnership:
    def test_a_rival_cannot_edit_a_profile(self, service, make_performer, rival):
        from apps.performers.exceptions import NotPerformerOwnerError

        performer = make_performer()
        with pytest.raises(NotPerformerOwnerError):
            service.update_performer(
                performer_id=performer.id,
                actor_id=rival.id,
                expected_version=performer.version,
                changes={"stage_name": "Stolen"},
            )

    def test_a_rival_cannot_read_a_draft_through_the_owner_endpoint(self, make_performer, rival):
        performer = make_performer(status=PerformerStatus.DRAFT)
        response = authed(rival).get(f"/api/v1/me/performers/{performer.id}")
        # 404 rather than 403 — a 403 confirms the profile exists.
        assert response.status_code == 404

    def test_creating_under_somebody_elses_organisation_is_refused(
        self, service, rival_organization, owner
    ):
        from apps.performers.exceptions import NotPerformerOwnerError

        with pytest.raises(NotPerformerOwnerError):
            service.create_performer(
                organization_id=rival_organization.id,
                actor_id=owner.id,
                stage_name="Trespass",
                performer_type=PerformerType.DJ,
                city="Mumbai",
            )

    def test_a_stale_version_is_refused(self, service, make_performer, owner):
        from apps.performers.exceptions import StalePerformerVersionError

        performer = make_performer()
        with pytest.raises(StalePerformerVersionError):
            service.update_performer(
                performer_id=performer.id,
                actor_id=owner.id,
                expected_version=99,
                changes={"stage_name": "New"},
            )


# ------------------------------------------------------------- readiness


@pytest.mark.django_db
class TestReadiness:
    def test_a_bare_draft_lists_what_is_missing(self, make_performer):
        performer = make_performer(status=PerformerStatus.DRAFT, bio="", genres=[], occasions=[])
        problems = readiness_problems(performer, photo_count=0)
        assert len(problems) == 4

    def test_a_complete_draft_has_no_problems(self, make_performer):
        performer = make_performer(status=PerformerStatus.DRAFT)
        assert readiness_problems(performer, photo_count=1) == []

    def test_submitting_an_incomplete_profile_is_refused_with_the_reason(
        self, service, make_performer, owner
    ):
        """Told BEFORE an operator sees it. Discovering the requirements from a
        rejection is a round trip through a human for nothing."""
        performer = make_performer(status=PerformerStatus.DRAFT, bio="")

        with pytest.raises(InvalidInputError) as caught:
            service.submit_for_review(performer_id=performer.id, actor_id=owner.id)

        assert "paragraph" in str(caught.value)

    def test_submitting_a_complete_profile_moves_it_to_the_queue(
        self, service, make_performer, with_photo, owner
    ):
        performer = make_performer(status=PerformerStatus.DRAFT)
        with_photo(performer)

        submitted = service.submit_for_review(performer_id=performer.id, actor_id=owner.id)

        assert submitted.status == PerformerStatus.PENDING_REVIEW
        assert submitted.submitted_at is not None

    def test_a_live_profile_cannot_be_resubmitted(self, service, make_performer, owner):
        from apps.performers.exceptions import InvalidPerformerStateError

        performer = make_performer(status=PerformerStatus.LIVE)
        with pytest.raises(InvalidPerformerStateError):
            service.submit_for_review(performer_id=performer.id, actor_id=owner.id)


# ------------------------------------------------------------ moderation


@pytest.mark.django_db
class TestModeration:
    def test_approval_makes_the_profile_public(self, moderation, make_performer, staff):
        performer = make_performer(status=PerformerStatus.PENDING_REVIEW)

        approved = moderation.moderate(performer_id=performer.id, actor_id=staff.id, approve=True)

        assert approved.status == PerformerStatus.LIVE
        assert [row.id for row in PerformerRepository().list_published()] == [performer.id]

    def test_a_rejection_needs_a_reason(self, moderation, make_performer, staff):
        """The performer sees this exact text and cannot fix what they have not
        been told."""
        performer = make_performer(status=PerformerStatus.PENDING_REVIEW)

        with pytest.raises(InvalidInputError):
            moderation.moderate(performer_id=performer.id, actor_id=staff.id, approve=False)

    def test_a_rejection_records_the_reason(self, moderation, make_performer, staff):
        performer = make_performer(status=PerformerStatus.PENDING_REVIEW)

        rejected = moderation.moderate(
            performer_id=performer.id,
            actor_id=staff.id,
            approve=False,
            note="The photos are stock images.",
        )

        assert rejected.status == PerformerStatus.REJECTED
        assert rejected.moderation_note == "The photos are stock images."

    def test_resubmitting_clears_the_stale_note(
        self, service, moderation, make_performer, with_photo, owner, staff
    ):
        """Leaving a stale rejection on a profile now awaiting a fresh review is
        how an operator rejects it twice for a problem already fixed."""
        performer = make_performer(status=PerformerStatus.PENDING_REVIEW)
        with_photo(performer)
        moderation.moderate(
            performer_id=performer.id, actor_id=staff.id, approve=False, note="Fix the photos."
        )

        resubmitted = service.submit_for_review(performer_id=performer.id, actor_id=owner.id)

        assert resubmitted.moderation_note == ""

    def test_two_operators_cannot_both_decide(self, moderation, make_performer, staff):
        """The conditional UPDATE makes this a real race, not a theoretical
        one — the second decision matches zero rows."""
        from apps.performers.exceptions import PerformerNotUnderReviewError

        performer = make_performer(status=PerformerStatus.PENDING_REVIEW)
        moderation.moderate(performer_id=performer.id, actor_id=staff.id, approve=True)

        with pytest.raises(PerformerNotUnderReviewError):
            moderation.moderate(performer_id=performer.id, actor_id=staff.id, approve=True)

    def test_only_a_live_profile_can_be_featured(self, moderation, make_performer, staff):
        """Featuring a draft would put it on the landing page while it is
        invisible everywhere else."""
        from apps.performers.exceptions import InvalidPerformerStateError

        performer = make_performer(status=PerformerStatus.DRAFT)
        with pytest.raises(InvalidPerformerStateError):
            moderation.set_featured(performer_id=performer.id, actor_id=staff.id, featured=True)

    def test_the_moderation_queue_is_staff_only(self, owner, make_performer):
        make_performer(status=PerformerStatus.PENDING_REVIEW)
        assert authed(owner).get("/api/v1/admin/performers").status_code == 403

    def test_a_draft_cannot_be_reached_by_guessing_a_status(self, staff, make_performer):
        """An unsubmitted profile is the owner's private workspace."""
        make_performer(status=PerformerStatus.DRAFT)
        body = authed(staff).get("/api/v1/admin/performers?status=draft").json()
        assert body["data"] == []


# ------------------------------------------------------------- the brief


@pytest.mark.django_db
class TestBookingRequests:
    def test_a_customer_can_post_a_brief(self, marketplace, customer):
        request = marketplace.create_request(
            customer_id=customer.id,
            performer_type=PerformerType.BAND,
            occasion=Occasion.WEDDING,
            city="Mumbai",
            event_date=(timezone.now() + dt.timedelta(days=30)).date(),
            budget_min_minor=5_000_00,
            budget_max_minor=15_000_00,
        )
        assert request.status == RequestStatus.OPEN

    def test_a_date_in_the_past_is_refused(self, marketplace, customer):
        with pytest.raises(InvalidInputError):
            marketplace.create_request(
                customer_id=customer.id,
                performer_type=PerformerType.BAND,
                occasion=Occasion.WEDDING,
                city="Mumbai",
                event_date=(timezone.now() - dt.timedelta(days=1)).date(),
                budget_min_minor=1,
                budget_max_minor=2,
            )

    def test_an_inverted_budget_is_refused_by_the_database_too(self, customer):
        """The service checks it, and so does a CheckConstraint — a range whose
        max is below its min silently matches nothing."""
        with pytest.raises(IntegrityError), transaction.atomic():
            BookingRequest.objects.create(
                customer=customer,
                performer_type=PerformerType.BAND,
                city="Mumbai",
                event_date=(timezone.now() + dt.timedelta(days=10)).date(),
                budget_min_minor=100,
                budget_max_minor=10,
            )

    def test_a_lead_tells_the_performer_nothing_about_the_customer(
        self, owner, make_performer, make_request
    ):
        """A brief is a job to bid on. The customer's identity is not the
        performer's to have until they are hired."""
        performer = make_performer()
        make_request()

        body = authed(owner).get(f"/api/v1/me/performers/{performer.id}/leads").json()
        row = body["data"][0]

        assert "customer" not in row
        assert "customer_email" not in row
        assert "asha" not in str(row).lower()

    def test_leads_are_matched_on_type_city_and_budget(self, make_performer, make_request):
        performer = make_performer(performer_type=PerformerType.BAND, city="Mumbai")
        matching = make_request()
        make_request(performer_type=PerformerType.DJ)
        make_request(city="Pune")
        # Ceiling below the act's floor is not a lead, it is noise.
        make_request(budget_min_minor=10, budget_max_minor=100)

        rows = BookingRequestRepository().list_open_for_performer(performer)

        assert [row.id for row in rows] == [matching.id]


# ---------------------------------------------------------------- quotes


@pytest.mark.django_db
class TestQuotes:
    def test_a_performer_can_quote(self, marketplace, make_performer, make_request, owner):
        performer = make_performer()
        request = make_request()

        quote = marketplace.submit_quote(
            request_id=request.id,
            performer_id=performer.id,
            actor_id=owner.id,
            amount_minor=9_000_00,
        )

        assert quote.status == QuoteStatus.PENDING

    def test_an_unapproved_performer_cannot_quote(
        self, marketplace, make_performer, make_request, owner
    ):
        """The same rule that keeps a draft invisible keeps it from selling."""
        from apps.performers.exceptions import PerformerNotBookableError

        performer = make_performer(status=PerformerStatus.DRAFT)
        request = make_request()

        with pytest.raises(PerformerNotBookableError):
            marketplace.submit_quote(
                request_id=request.id,
                performer_id=performer.id,
                actor_id=owner.id,
                amount_minor=1,
            )

    def test_one_quote_per_performer_per_request(
        self, marketplace, make_performer, make_request, owner
    ):
        """Enforced by the DATABASE — a check-then-insert leaves a window two
        concurrent submissions both pass."""
        from apps.performers.exceptions import DuplicateQuoteError

        performer = make_performer()
        request = make_request()
        marketplace.submit_quote(
            request_id=request.id,
            performer_id=performer.id,
            actor_id=owner.id,
            amount_minor=1_000_00,
        )

        with pytest.raises(DuplicateQuoteError):
            marketplace.submit_quote(
                request_id=request.id,
                performer_id=performer.id,
                actor_id=owner.id,
                amount_minor=2_000_00,
            )

    def test_a_rival_cannot_quote_for_somebody_elses_act(
        self, marketplace, make_performer, make_request, rival
    ):
        from apps.performers.exceptions import NotPerformerOwnerError

        performer = make_performer()
        request = make_request()

        with pytest.raises(NotPerformerOwnerError):
            marketplace.submit_quote(
                request_id=request.id,
                performer_id=performer.id,
                actor_id=rival.id,
                amount_minor=1,
            )

    def test_quotes_are_listed_cheapest_first(
        self, marketplace, make_performer, make_request, owner, rival_organization, rival
    ):
        """A customer comparing quotes is comparing price; newest-first would
        make them scroll to compare."""
        request = make_request()
        cheap = make_performer(stage_name="Cheap")
        dear = make_performer(stage_name="Dear")

        marketplace.submit_quote(
            request_id=request.id, performer_id=dear.id, actor_id=owner.id, amount_minor=20_000_00
        )
        marketplace.submit_quote(
            request_id=request.id, performer_id=cheap.id, actor_id=owner.id, amount_minor=6_000_00
        )

        rows = QuoteRepository().list_for_request(request.id)
        assert [row.performer.stage_name for row in rows] == ["Cheap", "Dear"]


# ------------------------------------------------------------------ hire


@pytest.mark.django_db
class TestHiring:
    def test_accepting_closes_the_request_and_declines_the_rest(
        self, marketplace, make_performer, make_request, owner, customer
    ):
        """The module's most important test. All three happen together, or a
        customer ends up having promised the date twice."""
        request = make_request()
        winner = make_performer(stage_name="Winner")
        loser = make_performer(stage_name="Loser")

        winning = marketplace.submit_quote(
            request_id=request.id, performer_id=winner.id, actor_id=owner.id, amount_minor=7_000_00
        )
        losing = marketplace.submit_quote(
            request_id=request.id, performer_id=loser.id, actor_id=owner.id, amount_minor=9_000_00
        )

        marketplace.accept_quote(quote_id=winning.id, customer_id=customer.id)

        request.refresh_from_db()
        losing.refresh_from_db()
        winning.refresh_from_db()

        assert request.status == RequestStatus.BOOKED
        assert request.booked_performer_id == winner.id
        assert winning.status == QuoteStatus.ACCEPTED
        # Not left pending: a performer whose quote sits pending forever cannot
        # tell a lost bid from a slow customer, and will hold the date.
        assert losing.status == QuoteStatus.DECLINED

    def test_a_second_accept_is_refused(
        self, marketplace, make_performer, make_request, owner, customer
    ):
        from apps.performers.exceptions import RequestClosedError

        request = make_request()
        first = make_performer(stage_name="First")
        second = make_performer(stage_name="Second")
        one = marketplace.submit_quote(
            request_id=request.id, performer_id=first.id, actor_id=owner.id, amount_minor=1_000_00
        )
        two = marketplace.submit_quote(
            request_id=request.id, performer_id=second.id, actor_id=owner.id, amount_minor=2_000_00
        )

        marketplace.accept_quote(quote_id=one.id, customer_id=customer.id)

        with pytest.raises(RequestClosedError):
            marketplace.accept_quote(quote_id=two.id, customer_id=customer.id)

    def test_only_the_requesting_customer_can_accept(
        self, marketplace, make_performer, make_request, owner, rival
    ):
        from apps.performers.exceptions import NotPerformerOwnerError

        request = make_request()
        performer = make_performer()
        quote = marketplace.submit_quote(
            request_id=request.id,
            performer_id=performer.id,
            actor_id=owner.id,
            amount_minor=1_000_00,
        )

        with pytest.raises(NotPerformerOwnerError):
            marketplace.accept_quote(quote_id=quote.id, customer_id=rival.id)

    def test_a_closed_request_takes_no_more_quotes(
        self, marketplace, make_performer, make_request, owner, customer
    ):
        from apps.performers.exceptions import RequestClosedError

        request = make_request()
        winner = make_performer(stage_name="Winner")
        latecomer = make_performer(stage_name="Latecomer")
        quote = marketplace.submit_quote(
            request_id=request.id, performer_id=winner.id, actor_id=owner.id, amount_minor=1_000_00
        )
        marketplace.accept_quote(quote_id=quote.id, customer_id=customer.id)

        with pytest.raises(RequestClosedError):
            marketplace.submit_quote(
                request_id=request.id,
                performer_id=latecomer.id,
                actor_id=owner.id,
                amount_minor=1,
            )

    def test_a_performer_can_withdraw_before_a_decision(
        self, marketplace, make_performer, make_request, owner
    ):
        request = make_request()
        performer = make_performer()
        quote = marketplace.submit_quote(
            request_id=request.id,
            performer_id=performer.id,
            actor_id=owner.id,
            amount_minor=1_000_00,
        )

        withdrawn = marketplace.withdraw_quote(quote_id=quote.id, actor_id=owner.id)

        assert withdrawn.status == QuoteStatus.WITHDRAWN


# ------------------------------------------------------------ query cost


@pytest.mark.django_db
def test_a_browse_page_costs_a_fixed_number_of_queries(
    make_performer, with_photo, django_assert_num_queries
):
    """`select_related` for the organisation and ONE grouped query for the
    photos, so a page of cards is two queries regardless of length. Without the
    grouped photo read this grid is a classic N+1.
    """
    from apps.performers.selectors import decorate_cards

    for index in range(5):
        with_photo(make_performer(stage_name=f"Act {index}"))

    with django_assert_num_queries(2):
        decorate_cards(list(PerformerRepository().list_published()[:5]))


@pytest.mark.django_db
def test_a_customers_request_list_costs_a_fixed_number_of_queries(
    make_request, django_assert_num_queries, customer
):
    """One grouped query for every quote count, not one per row."""
    from apps.performers.selectors import decorate_requests

    for _ in range(4):
        make_request()

    rows = list(BookingRequestRepository().list_for_customer(customer.id)[:4])
    with django_assert_num_queries(1):
        decorate_requests(rows)


@pytest.mark.django_db
def test_accepting_publishes_an_outbox_event(
    marketplace, make_performer, make_request, owner, customer, django_capture_on_commit_callbacks
):
    from core.models import OutboxEvent

    request = make_request()
    performer = make_performer()
    quote = marketplace.submit_quote(
        request_id=request.id, performer_id=performer.id, actor_id=owner.id, amount_minor=1_000_00
    )

    with django_capture_on_commit_callbacks(execute=True):
        marketplace.accept_quote(quote_id=quote.id, customer_id=customer.id)

    assert OutboxEvent.objects.filter(event_type="performers.quote_accepted").exists()


# ------------------------------------------------------- the owner's photos


@pytest.mark.django_db
class TestOwnerPhotos:
    """The studio cannot manage what it cannot see.

    The public detail carries photos but 404s for anything unapproved, so
    without them on the owner payload a performer could upload a photo and
    never see it again while their profile was still a draft.
    """

    def test_a_draft_owner_sees_their_own_photos(self, owner, make_performer, with_photo):
        performer = make_performer(status=PerformerStatus.DRAFT)
        with_photo(performer)

        body = authed(owner).get(f"/api/v1/me/performers/{performer.id}").json()

        assert len(body["photos"]) == 1
        assert body["photos"][0]["alt_text"] == "The quartet on stage at dusk"

    def test_the_owner_list_carries_them_too(self, owner, make_performer, with_photo):
        performer = make_performer(status=PerformerStatus.DRAFT)
        with_photo(performer)

        body = authed(owner).get("/api/v1/me/performers").json()

        assert len(body["data"][0]["photos"]) == 1

    def test_a_performer_with_no_photos_gets_an_empty_list(self, owner, make_performer):
        """Not a missing key — the studio renders an empty gallery, not a
        crash."""
        make_performer(status=PerformerStatus.DRAFT)
        body = authed(owner).get("/api/v1/me/performers").json()
        assert body["data"][0]["photos"] == []

    def test_a_removed_photo_disappears(self, owner, make_performer, with_photo):
        performer = make_performer(status=PerformerStatus.DRAFT)
        photo = with_photo(performer)

        authed(owner).delete(f"/api/v1/me/performers/{performer.id}/photos/{photo.id}")
        body = authed(owner).get(f"/api/v1/me/performers/{performer.id}").json()

        assert body["photos"] == []

    def test_a_page_of_acts_costs_one_photo_query(
        self, owner, make_performer, with_photo, django_assert_num_queries
    ):
        """The whole point of attaching them in the view. Per-row lookups here
        would be an N+1 across the owner's list."""
        for index in range(5):
            with_photo(make_performer(stage_name=f"Act {index}"))

        client = authed(owner)
        # One for the page, one for every photo on it. The assertion is on the
        # PHOTO read not growing with the row count.
        with django_assert_num_queries(2):
            list(
                PerformerMediaRepository().all_media_for_many(
                    [row.id for row in PerformerRepository().list_by_owner(owner.id)]
                )
            )
        assert client.get("/api/v1/me/performers").status_code == 200
