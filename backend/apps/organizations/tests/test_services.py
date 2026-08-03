from unittest.mock import MagicMock

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.accounts.models import User
from apps.accounts.repositories import UserRepository
from apps.organizations.exceptions import (
    NotOrganizationOwnerError,
    NotPlatformOperatorError,
    OrganizationNotFoundError,
)
from apps.organizations.models import VerificationStatus, VerifiedLevel
from apps.organizations.repositories import OrganizationRepository
from apps.organizations.services import OrganizationService
from core.adapters.local.fake_payment import FakePaymentAdapter
from core.adapters.local.local_storage import LocalStorageAdapter
from core.adapters.local.sync_task_queue import SyncTaskQueueAdapter
from core.models import OutboxEvent
from core.ports.task_queue_port import TaskQueuePort


@pytest.fixture
def owner():
    return UserRepository().create_user(email="owner@example.com", password="s3cur3pass")


@pytest.fixture
def operator() -> User:
    """A platform operator. `is_staff` is the platform's single definition of
    one (see apps/console/permissions.py)."""
    return User.objects.create_user(email="ops@example.com", password="opspass12345", is_staff=True)


@pytest.fixture
def storage(tmp_path) -> LocalStorageAdapter:
    return LocalStorageAdapter(root=tmp_path, base_url="/media/")


@pytest.fixture
def payments() -> FakePaymentAdapter:
    return FakePaymentAdapter()


@pytest.fixture
def org_service(storage, payments) -> OrganizationService:
    return OrganizationService(
        organizations=OrganizationRepository(),
        users=UserRepository(),
        storage=storage,
        payments=payments,
        task_queue=SyncTaskQueueAdapter(),
    )


@pytest.mark.django_db
def test_create_organization_grants_the_organizer_role(org_service, owner):
    assert owner.is_organizer is False

    org = org_service.create_organization(owner_id=owner.id, name="Acme Events")

    assert org.name == "Acme Events"
    owner.refresh_from_db()
    assert owner.is_organizer is True


@pytest.mark.django_db
def test_create_organization_uploads_logo_via_storage_port(org_service, storage):
    owner = UserRepository().create_user(email="logo@example.com", password="s3cur3pass")
    logo = SimpleUploadedFile("logo.png", b"fake-image-bytes", content_type="image/png")

    org = org_service.create_organization(owner_id=owner.id, name="Acme Events", logo=logo)

    assert org.logo_url.startswith("/media/org-logos/")
    assert org.logo_url.endswith("-logo.png")


@pytest.mark.django_db
def test_create_organization_publishes_outbox_event(org_service, owner):
    org = org_service.create_organization(owner_id=owner.id, name="Acme Events")

    event = OutboxEvent.objects.get(event_type="organizations.organization_created")
    assert event.aggregate_id == str(org.id)
    assert event.payload["owner_email"] == owner.email


@pytest.mark.django_db
def test_update_organization_by_owner_succeeds(org_service, owner):
    org = org_service.create_organization(owner_id=owner.id, name="Old Name")

    updated = org_service.update_organization(
        organization_id=org.id, actor_id=owner.id, name="New Name"
    )

    assert updated.name == "New Name"


@pytest.mark.django_db
def test_update_organization_by_non_owner_is_denied(org_service, owner):
    org = org_service.create_organization(owner_id=owner.id, name="Acme Events")
    other = UserRepository().create_user(email="intruder@example.com", password="s3cur3pass")

    with pytest.raises(NotOrganizationOwnerError):
        org_service.update_organization(organization_id=org.id, actor_id=other.id, name="Hijacked")


@pytest.mark.django_db
def test_update_missing_organization_raises_not_found(org_service, owner):
    with pytest.raises(OrganizationNotFoundError):
        org_service.update_organization(
            organization_id="00000000-0000-0000-0000-000000000000", actor_id=owner.id, name="x"
        )


@pytest.mark.django_db
def test_submit_verification_creates_a_pending_record_and_marks_the_org_pending(org_service, owner):
    org = org_service.create_organization(owner_id=owner.id, name="Acme Events")

    record = org_service.submit_verification(
        organization_id=org.id, actor_id=owner.id, notes="please review"
    )

    assert record.status == VerificationStatus.PENDING
    assert record.notes == "please review"
    org.refresh_from_db()
    assert org.verified_level == VerifiedLevel.PENDING


@pytest.mark.django_db
def test_submit_verification_by_non_owner_is_denied(org_service, owner):
    org = org_service.create_organization(owner_id=owner.id, name="Acme Events")
    other = UserRepository().create_user(email="intruder2@example.com", password="s3cur3pass")

    with pytest.raises(NotOrganizationOwnerError):
        org_service.submit_verification(organization_id=org.id, actor_id=other.id)


@pytest.mark.django_db
def test_submitting_verification_never_approves_itself(
    storage, payments, owner, django_capture_on_commit_callbacks
):
    """THE approval-gate test for this module.

    Submitting used to enqueue `organizations.process_verification`, the KYC
    stand-in that always approves — and with `QUEUE_BACKEND=local` that task
    runs INLINE, so every organization on the platform verified itself in
    milliseconds and the operator queue was permanently empty. A gate that
    approves itself is a gate reporting green.

    The mock queue is what proves it: nothing is enqueued at all, so no
    substitute auto-approver can be reintroduced without failing here.
    """
    task_queue = MagicMock(spec=TaskQueuePort)
    service = OrganizationService(
        organizations=OrganizationRepository(),
        users=UserRepository(),
        storage=storage,
        payments=payments,
        task_queue=task_queue,
    )
    org = service.create_organization(owner_id=owner.id, name="Acme Events")

    with django_capture_on_commit_callbacks(execute=True):
        record = service.submit_verification(organization_id=org.id, actor_id=owner.id)

    task_queue.enqueue.assert_not_called()
    record.refresh_from_db()
    assert record.status == VerificationStatus.PENDING
    assert record.processed_at is None
    org.refresh_from_db()
    assert org.verified_level == VerifiedLevel.PENDING


@pytest.mark.django_db
def test_a_submitted_verification_reaches_the_operator_queue(org_service, owner):
    """The queue was empty for the whole life of the platform because nothing
    stayed pending long enough to appear in it. This is the read the operator
    console makes."""
    org = org_service.create_organization(owner_id=owner.id, name="Acme Events")

    org_service.submit_verification(organization_id=org.id, actor_id=owner.id)

    pending = OrganizationRepository().get_latest_pending_verification(org.id)
    assert pending is not None
    assert pending.status == VerificationStatus.PENDING


@pytest.mark.django_db
def test_submitting_verification_tells_somebody_it_is_waiting(org_service, owner):
    """Removing the auto-approval is only an improvement if a human is told.

    `submit_verification` used to publish NOTHING — the old `with UnitOfWork():`
    bound no `uow` — so an organization could wait forever with the operator
    queue unread. `notifications` already subscribes to this event type.
    """
    org = org_service.create_organization(owner_id=owner.id, name="Acme Events")

    record = org_service.submit_verification(organization_id=org.id, actor_id=owner.id)

    published = OutboxEvent.objects.get(
        event_type="organizations.organization_verification_submitted"
    )
    assert published.aggregate_id == str(org.id)
    # The per-submission discriminator. Keyed on the organization alone, a
    # re-application after a rejection would be deduped against the first
    # alert and silently never sent.
    assert published.payload["verification_id"] == str(record.id)
    assert published.payload["owner_email"] == owner.email
    assert published.payload["name"] == "Acme Events"


@pytest.mark.django_db
def test_a_resubmission_is_a_distinct_alert(org_service, owner, operator):
    """A rejected organization that fixes its paperwork and re-applies must
    reach an operator again."""
    org = org_service.create_organization(owner_id=owner.id, name="Acme Events")
    first = org_service.submit_verification(organization_id=org.id, actor_id=owner.id)
    org_service.decide_verification(
        organization_id=org.id, actor_id=operator.id, approve=False, notes="Unreadable."
    )

    second = org_service.submit_verification(organization_id=org.id, actor_id=owner.id)

    submissions = OutboxEvent.objects.filter(
        event_type="organizations.organization_verification_submitted"
    ).order_by("created_at")
    assert [entry.payload["verification_id"] for entry in submissions] == [
        str(first.id),
        str(second.id),
    ]


@pytest.mark.django_db
def test_only_an_operator_can_approve_a_verification(org_service, owner):
    """An organizer approving their own verification would make the whole gate
    decorative. The service refuses it for itself rather than trusting the
    console view to have checked."""
    org = org_service.create_organization(owner_id=owner.id, name="Acme Events")
    org_service.submit_verification(organization_id=org.id, actor_id=owner.id)

    with pytest.raises(NotPlatformOperatorError):
        org_service.decide_verification(organization_id=org.id, actor_id=owner.id, approve=True)

    org.refresh_from_db()
    assert org.verified_level == VerifiedLevel.PENDING


@pytest.mark.django_db
def test_an_operator_decision_is_the_only_thing_that_verifies_an_organization(
    org_service, owner, operator
):
    org = org_service.create_organization(owner_id=owner.id, name="Acme Events")
    org_service.submit_verification(organization_id=org.id, actor_id=owner.id)

    record = org_service.decide_verification(
        organization_id=org.id, actor_id=operator.id, approve=True
    )

    assert record.status == VerificationStatus.APPROVED
    org.refresh_from_db()
    assert org.verified_level == VerifiedLevel.VERIFIED


@pytest.mark.django_db
def test_an_operator_can_refuse_a_verification(org_service, owner, operator):
    org = org_service.create_organization(owner_id=owner.id, name="Acme Events")
    org_service.submit_verification(organization_id=org.id, actor_id=owner.id)

    record = org_service.decide_verification(
        organization_id=org.id, actor_id=operator.id, approve=False, notes="Documents unreadable."
    )

    assert record.status == VerificationStatus.REJECTED
    org.refresh_from_db()
    assert org.verified_level == VerifiedLevel.UNVERIFIED


@pytest.mark.django_db
def test_link_payout_account_calls_payment_port_and_saves_the_id(org_service, payments, owner):
    org = org_service.create_organization(owner_id=owner.id, name="Acme Events")

    updated = org_service.link_payout_account(organization_id=org.id, actor_id=owner.id)

    assert updated.payout_account_id in payments.linked_accounts
    assert payments.linked_accounts[updated.payout_account_id]["reference_id"] == str(org.id)


@pytest.mark.django_db
def test_link_payout_account_publishes_outbox_event(org_service, owner):
    org = org_service.create_organization(owner_id=owner.id, name="Acme Events")

    org_service.link_payout_account(organization_id=org.id, actor_id=owner.id)

    event = OutboxEvent.objects.get(event_type="organizations.payout_account_linked")
    assert event.aggregate_id == str(org.id)


@pytest.mark.django_db
def test_link_payout_account_by_non_owner_is_denied(org_service, owner):
    org = org_service.create_organization(owner_id=owner.id, name="Acme Events")
    other = UserRepository().create_user(email="intruder3@example.com", password="s3cur3pass")

    with pytest.raises(NotOrganizationOwnerError):
        org_service.link_payout_account(organization_id=org.id, actor_id=other.id)
