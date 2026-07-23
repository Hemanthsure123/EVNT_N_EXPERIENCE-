from unittest.mock import MagicMock

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.accounts.repositories import UserRepository
from apps.organizations.exceptions import NotOrganizationOwnerError, OrganizationNotFoundError
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
def test_submit_verification_enqueues_the_processing_task(
    storage, payments, owner, django_capture_on_commit_callbacks
):
    # A mock TaskQueuePort here (rather than the real SyncTaskQueueAdapter)
    # keeps this test focused on "did the service ask for the task to run"
    # without also executing the task itself — that's covered in
    # test_tasks.py, tested directly rather than through the queue, to
    # avoid nested on_commit callbacks (the task opens its own UnitOfWork).
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

    task_queue.enqueue.assert_called_once_with(
        "organizations.process_verification",
        {"organization_id": str(org.id), "verification_id": str(record.id)},
    )


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
