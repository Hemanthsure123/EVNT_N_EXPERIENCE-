"""The crew roster and an event's lineup.

Two things in this file carry real weight, and the rest is scaffolding around
them:

1. **The cross-tenant check.** `PUT /events/{id}/crew` takes a list of ids from
   a browser. If one belongs to another organization and the write does not
   refuse, a guessed uuid puts a stranger's face and name on a public event
   page. That is the only genuine security boundary this feature has.
2. **The refusal is loud.** A stranger's id REFUSES the whole write rather than
   being silently dropped — an organizer who presses save, sees no error and
   later finds one of their choices missing has been lied to by the interface.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.events.models import CrewMember, EventCrew, EventStatus
from apps.events.repositories import CrewMemberRepository, EventCrewRepository
from apps.events.services import CrewService
from apps.organizations.models import Organization
from apps.organizations.repositories import OrganizationRepository
from core.errors import ConflictError, InvalidInputError, NotFoundError

from .conftest import *  # noqa: F401,F403 — reuse the module's fixtures


@pytest.fixture
def crew_service() -> CrewService:
    """Constructed directly with real repositories — never through `config.di`,
    which would make the test depend on settings' backend selection."""
    return CrewService(organizations=OrganizationRepository(), crew=CrewMemberRepository())


@pytest.fixture
def content_service():
    from apps.events.repositories import EventContentRepository, EventRepository
    from apps.events.services import EventContentService
    from core.adapters.local.local_storage import LocalStorageAdapter

    return EventContentService(
        events=EventRepository(),
        content=EventContentRepository(),
        storage=LocalStorageAdapter(),
    )


@pytest.fixture
def member(crew_service, organization, owner):
    return crew_service.add_member(
        organization_id=organization.id, actor_id=owner.id, name="DJ Voices", role="DJ"
    )


@pytest.fixture
def rival(db):
    """Another organization, its owner, and one crew member — the far side of
    every boundary in this file."""
    user = User.objects.create_user(email="rival@example.com", password="rivalpass123456")
    org = Organization.objects.create(owner=user, name="Rival Nights")
    person = CrewMember.objects.create(organization=org, name="Dotdat", role="producer")
    client = APIClient()
    client.force_authenticate(user=user)
    return {"user": user, "organization": org, "member": person, "client": client}


# ── The roster ──────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestTheRoster:
    def test_a_member_is_added_and_listed(self, crew_service, organization, owner, member):
        rows = crew_service.list_roster(organization_id=organization.id, actor_id=owner.id)

        assert [row.name for row in rows] == ["DJ Voices"]
        assert rows[0].role == "DJ"

    def test_another_organizations_roster_is_not_visible(self, crew_service, rival, owner):
        """A 404 rather than a 403: a 403 confirms the organization exists to
        anyone guessing ids."""
        with pytest.raises(NotFoundError):
            crew_service.list_roster(organization_id=rival["organization"].id, actor_id=owner.id)

    def test_a_removed_member_leaves_the_roster(self, crew_service, organization, owner, member):
        crew_service.remove_member(
            organization_id=organization.id, actor_id=owner.id, member_id=member.id
        )

        assert crew_service.list_roster(organization_id=organization.id, actor_id=owner.id) == []

    def test_a_retired_member_stays_on_the_roster_but_leaves_the_picker(
        self, crew_service, organization, owner, member
    ):
        """The two lists answer different questions. The management screen has
        to keep showing somebody so they can be brought back; the event picker
        must not offer them."""
        crew_service.update_member(
            organization_id=organization.id,
            actor_id=owner.id,
            member_id=member.id,
            is_active=False,
        )

        full = crew_service.list_roster(organization_id=organization.id, actor_id=owner.id)
        picker = crew_service.list_roster(
            organization_id=organization.id, actor_id=owner.id, active_only=True
        )
        assert [row.id for row in full] == [member.id]
        assert picker == []

    def test_a_stranger_cannot_edit_your_member(self, crew_service, rival, organization, owner):
        """Scoped by organization in the QUERY, so the row is never loaded at
        all rather than loaded and then refused."""
        with pytest.raises(NotFoundError):
            crew_service.update_member(
                organization_id=organization.id,
                actor_id=owner.id,
                member_id=rival["member"].id,
                name="Renamed",
            )

    def test_the_roster_is_bounded(self, crew_service, organization, owner, monkeypatch):
        """An authenticated endpoint that loops over whatever it is handed is
        an unbounded write."""
        monkeypatch.setattr(CrewService, "MAX_ROSTER", 2)
        for index in range(2):
            crew_service.add_member(
                organization_id=organization.id, actor_id=owner.id, name=f"Person {index}"
            )

        with pytest.raises(InvalidInputError):
            crew_service.add_member(
                organization_id=organization.id, actor_id=owner.id, name="One too many"
            )

    def test_removing_somebody_on_a_lineup_is_refused_with_the_alternative(
        self, crew_service, content_service, organization, owner, member, make_event
    ):
        """`EventCrew.member` is PROTECT, so the database would stop this
        anyway — but as an IntegrityError. The organizer deserves to be told
        that the person is on an event and that deactivating is what they
        actually want."""
        event = make_event()
        content_service.set_event_crew(
            event_id=event.id, actor_id=owner.id, member_ids=[str(member.id)]
        )

        with pytest.raises(ConflictError) as raised:
            crew_service.remove_member(
                organization_id=organization.id, actor_id=owner.id, member_id=member.id
            )
        assert "Deactivate" in str(raised.value)


# ── The lineup ──────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestTheLineup:
    def test_setting_a_lineup_keeps_the_chosen_order(
        self, content_service, crew_service, organization, owner, make_event
    ):
        event = make_event()
        first = crew_service.add_member(
            organization_id=organization.id, actor_id=owner.id, name="Opener"
        )
        second = crew_service.add_member(
            organization_id=organization.id, actor_id=owner.id, name="Headliner"
        )

        rows = content_service.set_event_crew(
            event_id=event.id, actor_id=owner.id, member_ids=[str(second.id), str(first.id)]
        )

        # The organizer's ordering in the picker is the ordering on the page.
        # Sorting alphabetically would put the support act on top.
        assert [row.member.name for row in rows] == ["Headliner", "Opener"]
        assert [row.position for row in rows] == [0, 1]

    def test_it_replaces_rather_than_appends(
        self, content_service, crew_service, organization, owner, make_event, member
    ):
        """Set replacement is the contract: the control upstream is a
        multi-select, and a save that appended would make the lineup grow every
        time somebody pressed it."""
        event = make_event()
        other = crew_service.add_member(
            organization_id=organization.id, actor_id=owner.id, name="Replacement"
        )
        content_service.set_event_crew(
            event_id=event.id, actor_id=owner.id, member_ids=[str(member.id)]
        )

        rows = content_service.set_event_crew(
            event_id=event.id, actor_id=owner.id, member_ids=[str(other.id)]
        )

        assert [row.member_id for row in rows] == [other.id]
        assert EventCrew.objects.filter(event_id=event.id).count() == 1

    def test_an_empty_list_clears_the_lineup(self, content_service, owner, make_event, member):
        event = make_event()
        content_service.set_event_crew(
            event_id=event.id, actor_id=owner.id, member_ids=[str(member.id)]
        )

        assert (
            content_service.set_event_crew(event_id=event.id, actor_id=owner.id, member_ids=[])
            == []
        )

    def test_another_organizations_member_is_refused(
        self, content_service, owner, make_event, member, rival
    ):
        """THE test in this file.

        Without it, a guessed uuid puts a stranger's face and name on a public
        event page — the only genuine security boundary this feature has.
        """
        event = make_event()

        with pytest.raises(InvalidInputError):
            content_service.set_event_crew(
                event_id=event.id,
                actor_id=owner.id,
                member_ids=[str(member.id), str(rival["member"].id)],
            )

    def test_a_refused_write_changes_nothing(
        self, content_service, owner, make_event, member, rival
    ):
        """The stranger's id refuses the WHOLE write rather than being silently
        dropped. Pressing save, seeing no error and finding a choice missing is
        worse than being refused."""
        event = make_event()
        content_service.set_event_crew(
            event_id=event.id, actor_id=owner.id, member_ids=[str(member.id)]
        )

        with pytest.raises(InvalidInputError):
            content_service.set_event_crew(
                event_id=event.id, actor_id=owner.id, member_ids=[str(rival["member"].id)]
            )

        assert [row.member_id for row in EventCrewRepository().for_event(event.id)] == [member.id]

    def test_a_retired_member_cannot_be_added_to_a_new_lineup(
        self, content_service, crew_service, organization, owner, make_event, member
    ):
        crew_service.update_member(
            organization_id=organization.id,
            actor_id=owner.id,
            member_id=member.id,
            is_active=False,
        )
        event = make_event()

        with pytest.raises(InvalidInputError):
            content_service.set_event_crew(
                event_id=event.id, actor_id=owner.id, member_ids=[str(member.id)]
            )

    def test_duplicates_are_collapsed_rather_than_crashing(
        self, content_service, owner, make_event, member
    ):
        """A multi-select double-fires on a slow connection, and
        `event_crew_unique_member` would turn that into an IntegrityError on a
        save that was entirely reasonable."""
        event = make_event()

        rows = content_service.set_event_crew(
            event_id=event.id, actor_id=owner.id, member_ids=[str(member.id), str(member.id)]
        )

        assert len(rows) == 1

    def test_the_lineup_is_bounded(self, content_service, owner, make_event, member, monkeypatch):
        monkeypatch.setattr(type(content_service), "MAX_LINEUP", 1)
        event = make_event()

        with pytest.raises(InvalidInputError):
            content_service.set_event_crew(
                event_id=event.id,
                actor_id=owner.id,
                member_ids=[str(member.id), "00000000-0000-0000-0000-000000000001"],
            )

    def test_another_organizers_event_is_not_writable(self, content_service, make_event, rival):
        from apps.events.exceptions import EventNotFoundError

        event = make_event()

        # NotFound, not PermissionDenied — a 403 confirms the event exists.
        with pytest.raises(EventNotFoundError):
            content_service.set_event_crew(
                event_id=event.id, actor_id=rival["user"].id, member_ids=[]
            )

    def test_the_lineup_read_does_not_n_plus_one(
        self,
        content_service,
        crew_service,
        organization,
        owner,
        make_event,
        django_assert_num_queries,
    ):
        """The public content read renders a name, a role and a photo per
        entry. Without `select_related`, an eight-person lineup is nine queries
        on the platform's hottest cached endpoint."""
        event = make_event()
        ids = [
            str(
                crew_service.add_member(
                    organization_id=organization.id, actor_id=owner.id, name=f"Act {index}"
                ).id
            )
            for index in range(8)
        ]
        content_service.set_event_crew(event_id=event.id, actor_id=owner.id, member_ids=ids)

        with django_assert_num_queries(1):
            rows = EventCrewRepository().for_event(event.id)
            assert [row.member.name for row in rows] == [f"Act {i}" for i in range(8)]


# ── The HTTP boundary ───────────────────────────────────────────────────────


@pytest.mark.django_db
class TestTheApi:
    def test_the_lineup_rides_on_the_public_content_payload(
        self, api_client, content_service, owner, make_event, member
    ):
        """One edge-cached round trip, not a second request before the section
        can paint."""
        event = make_event(status=EventStatus.LIVE)
        content_service.set_event_crew(
            event_id=event.id, actor_id=owner.id, member_ids=[str(member.id)]
        )

        body = api_client.get(f"/api/v1/events/{event.id}/content").json()

        assert [row["name"] for row in body["crew"]] == ["DJ Voices"]
        assert body["crew"][0]["role"] == "DJ"

    def test_a_per_event_billing_overrides_the_roster_role(
        self, api_client, content_service, owner, make_event, member
    ):
        """The same person is a DJ on one night and the host on another, and
        the fallback is resolved in ONE place so the public payload and the
        organizer's picker can never disagree."""
        event = make_event(status=EventStatus.LIVE)
        content_service.set_event_crew(
            event_id=event.id, actor_id=owner.id, member_ids=[str(member.id)]
        )
        EventCrew.objects.filter(event_id=event.id).update(billed_as="host")

        body = api_client.get(f"/api/v1/events/{event.id}/content").json()

        assert body["crew"][0]["role"] == "host"

    def test_the_roster_is_never_shared_cached(self, authed_client, organization):
        response = authed_client.get(f"/api/v1/organizations/{organization.id}/crew")

        assert response.status_code == 200
        assert response["Cache-Control"] == "private, no-store"

    def test_anonymous_cannot_read_a_roster(self, api_client, organization):
        assert api_client.get(f"/api/v1/organizations/{organization.id}/crew").status_code == 401

    def test_a_stranger_gets_a_404_not_a_403(self, rival, organization):
        assert (
            rival["client"].get(f"/api/v1/organizations/{organization.id}/crew").status_code == 404
        )

    def test_creating_and_setting_a_lineup_over_http(self, authed_client, organization, make_event):
        created = authed_client.post(
            f"/api/v1/organizations/{organization.id}/crew",
            {"name": "Live band", "role": "band"},
            format="json",
        )
        assert created.status_code == 201
        member_id = created.json()["id"]

        event = make_event()
        response = authed_client.put(
            f"/api/v1/events/{event.id}/crew", {"member_ids": [member_id]}, format="json"
        )

        assert response.status_code == 200
        assert [row["id"] for row in response.json()["data"]] == [member_id]

    def test_a_strangers_id_is_a_400_with_the_envelope(self, authed_client, make_event, rival):
        event = make_event()
        response = authed_client.put(
            f"/api/v1/events/{event.id}/crew",
            {"member_ids": [str(rival["member"].id)]},
            format="json",
        )

        # 422, not 400: `InvalidInputError` is a DOMAIN refusal (the ids parsed
        # fine, they just are not yours), where 400 is what DRF's own field
        # validation produces. The test below pins that other half.
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_input"

    def test_the_request_is_bounded_at_the_boundary(self, authed_client, make_event):
        """The serializer refuses an oversized list before any of it reaches
        the database."""
        event = make_event()
        response = authed_client.put(
            f"/api/v1/events/{event.id}/crew",
            {"member_ids": [f"00000000-0000-0000-0000-{i:012d}" for i in range(30)]},
            format="json",
        )

        assert response.status_code == 400


@pytest.fixture
def event_service():
    from apps.accounts.repositories import UserRepository
    from apps.events.repositories import EventRepository
    from apps.events.services import EventService
    from core.adapters.local.local_storage import LocalStorageAdapter
    from core.adapters.local.sync_task_queue import SyncTaskQueueAdapter

    return EventService(
        events=EventRepository(),
        organizations=OrganizationRepository(),
        users=UserRepository(),
        storage=LocalStorageAdapter(),
        task_queue=SyncTaskQueueAdapter(),
    )


@pytest.mark.django_db
def test_a_duplicated_event_carries_its_lineup(
    content_service, event_service, owner, make_event, member
):
    """A copy is a NEW event and inherits nothing it earned — no moderation
    history, no prices, no bookings. The LINEUP is different: it is the
    retyping `duplicate_event` exists to remove, and it points at the same
    roster rows rather than cloning people."""
    source = make_event()
    content_service.set_event_crew(
        event_id=source.id, actor_id=owner.id, member_ids=[str(member.id)]
    )

    clone = event_service.duplicate_event(event_id=source.id, actor_id=owner.id)

    assert [row.member_id for row in EventCrewRepository().for_event(clone.id)] == [member.id]
    assert CrewMember.objects.count() == 1  # the person was not duplicated
