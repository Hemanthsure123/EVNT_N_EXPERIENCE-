import pytest

from apps.accounts.repositories import UserRepository
from apps.organizations import tasks
from apps.organizations.models import VerificationStatus, VerifiedLevel
from apps.organizations.repositories import OrganizationRepository
from core.models import OutboxEvent


@pytest.fixture
def owner():
    return UserRepository().create_user(email="task-owner@example.com", password="s3cur3pass")


@pytest.mark.django_db
def test_process_verification_approves_and_verifies_the_org(
    owner, django_capture_on_commit_callbacks
):
    orgs = OrganizationRepository()
    org = orgs.create(owner_id=owner.id, name="Acme Events")
    record = orgs.create_verification_record(organization_id=org.id)

    with django_capture_on_commit_callbacks(execute=True):
        tasks.process_verification(
            {"organization_id": str(org.id), "verification_id": str(record.id)}
        )

    record.refresh_from_db()
    org.refresh_from_db()
    assert record.status == VerificationStatus.APPROVED
    assert record.processed_at is not None
    assert org.verified_level == VerifiedLevel.VERIFIED


@pytest.mark.django_db
def test_process_verification_publishes_organization_verified_event(owner):
    orgs = OrganizationRepository()
    org = orgs.create(owner_id=owner.id, name="Acme Events")
    record = orgs.create_verification_record(organization_id=org.id)

    tasks.process_verification({"organization_id": str(org.id), "verification_id": str(record.id)})

    event = OutboxEvent.objects.get(event_type="organizations.organization_verified")
    assert event.aggregate_id == str(org.id)
    assert event.payload["owner_email"] == owner.email


@pytest.mark.django_db
def test_process_verification_is_a_noop_for_a_missing_organization():
    # Must not raise — a background task landing after the org was deleted
    # is a normal race, not an error.
    tasks.process_verification(
        {
            "organization_id": "00000000-0000-0000-0000-000000000000",
            "verification_id": "00000000-0000-0000-0000-000000000000",
        }
    )
