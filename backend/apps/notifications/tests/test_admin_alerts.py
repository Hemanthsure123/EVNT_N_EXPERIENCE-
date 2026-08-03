"""Operator alerts — "something is waiting for your decision".

Exercised through the REAL wiring (config.di + console adapters + the sync task
queue), like test_handlers.py, so notify -> claim -> dispatch -> send runs
inline and we assert on the NotificationLog rows the module actually wrote.

Three properties matter and each has a test:
- it FIRES, once per configured operator, with a message that stands up in both
  plain text and HTML;
- it DEDUPES a redelivered domain event, but NOT a resubmission — the second is
  the case a naive key silently swallows, and it is the organiser who most
  needs an answer;
- it SKIPS CLEANLY when nobody configured an ops mailbox, without failing the
  submission that triggered it.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.db.models import F
from django.utils import timezone

from apps.accounts.repositories import UserRepository
from apps.events.models import Event
from apps.notifications import handlers
from apps.notifications.models import NotificationLog, NotificationStatus, NotificationType
from apps.performers.models import Performer, PerformerStatus, PerformerType

OPS = ["ops@curatix.test", "founder@curatix.test"]
SITE = "https://curatix.test"


@pytest.fixture
def ops(settings):
    """Two configured operators and a known site origin, so link assertions are
    about the template rather than about whatever .env happens to hold."""
    settings.PLATFORM_ADMIN_EMAILS = list(OPS)
    settings.PUBLIC_SITE_URL = SITE
    return list(OPS)


def _event_payload(event, *, owner_email="organiser@example.com") -> dict:
    """Exactly what apps/events/services.py publishes with
    EVENT_SUBMITTED_FOR_REVIEW — no more, no less."""
    return {
        "event_id": str(event.id),
        "organization_id": str(event.organization_id),
        "owner_email": owner_email,
        "title": event.title,
    }


# --- it fires ---------------------------------------------------------------


@pytest.mark.django_db
def test_event_submitted_alerts_every_configured_operator(ops, event):
    handlers.handle_event_submitted_for_review(_event_payload(event))

    logs = list(NotificationLog.objects.filter(type=NotificationType.ADMIN_EVENT_REVIEW))
    # ONE ROW PER ADDRESS: the ledger is keyed by (message, recipient), so a
    # second operator gets their own claim rather than being deduped away by
    # the first one's key.
    assert sorted(log.recipient for log in logs) == sorted(ops)
    for log in logs:
        assert log.channel == "email"
        assert log.status == NotificationStatus.SENT
        assert log.provider_ref


@pytest.mark.django_db
def test_the_event_alert_says_what_is_waiting_who_sent_it_and_where_to_decide(ops, event):
    handlers.handle_event_submitted_for_review(_event_payload(event))
    log = NotificationLog.objects.filter(type=NotificationType.ADMIN_EVENT_REVIEW).first()
    assert log is not None

    assert event.title in log.subject
    # BOTH PARTS, saying the same things. An HTML-only operations alert is one
    # a text client shows as an empty message.
    for part in (log.body, log.html_body):
        assert event.title in part  # what is waiting
        assert "organiser@example.com" in part  # who submitted it
        assert str(event.id) in part  # which row
        assert f"{SITE}/admin/moderation" in part  # where it is decided


@pytest.mark.django_db
def test_the_alert_carries_nothing_a_decision_does_not_need(ops, event):
    """It is an email, so it gets forwarded. An approval decision uses a title,
    a submitter and an id — never buyer, ticket or money data."""
    handlers.handle_event_submitted_for_review(_event_payload(event))
    log = NotificationLog.objects.filter(type=NotificationType.ADMIN_EVENT_REVIEW).first()
    assert log is not None

    haystack = f"{log.subject}\n{log.body}\n{log.html_body}".lower()
    for leak in ("qr code", "booking", "₹", "payout", "refund", "attend"):
        assert leak not in haystack
    # And no ticket PDF: the attachment exists to be carried to a gate, which
    # is not something an approval decision does.
    assert log.attachments_json == []


@pytest.mark.django_db
def test_a_performer_submission_alerts_the_same_queue(ops, organization, organizer):
    performer = Performer.objects.create(
        organization_id=organization.id,
        stage_name="The Bombay Brass",
        performer_type=PerformerType.BAND,
        city="Mumbai",
        status=PerformerStatus.PENDING_REVIEW,
    )

    handlers.handle_performer_submitted_for_review(
        {
            "performer_id": str(performer.id),
            "organization_id": str(organization.id),
            "stage_name": performer.stage_name,
        }
    )

    logs = list(NotificationLog.objects.filter(type=NotificationType.ADMIN_PERFORMER_REVIEW))
    assert sorted(log.recipient for log in logs) == sorted(ops)
    for part in (logs[0].body, logs[0].html_body):
        assert "The Bombay Brass" in part
        # Resolved from the owning organization — the payload does not carry it.
        assert organizer.email in part
        assert f"{SITE}/admin/performers" in part


@pytest.mark.django_db
def test_an_organization_verification_alerts_with_the_queue_link(ops, organization, organizer):
    handlers.handle_organization_verification_submitted(
        {
            "organization_id": str(organization.id),
            "verification_id": "11111111-1111-1111-1111-111111111111",
            "name": organization.name,
            "owner_email": organizer.email,
        }
    )

    logs = list(NotificationLog.objects.filter(type=NotificationType.ADMIN_ORG_VERIFICATION))
    assert sorted(log.recipient for log in logs) == sorted(ops)
    for part in (logs[0].body, logs[0].html_body):
        assert organization.name in part
        assert organizer.email in part
        assert f"{SITE}/admin/verifications" in part


@pytest.mark.django_db
def test_an_organization_alert_fills_in_what_the_publisher_did_not_carry(
    ops, organization, organizer
):
    """The handler's contract needs only `organization_id`. A publisher that
    sends nothing else must still produce a usable alert, not one addressed to
    "Unnamed organization"."""
    handlers.handle_organization_verification_submitted(
        {"organization_id": str(organization.id), "verification_id": "abc-1"}
    )

    log = NotificationLog.objects.filter(type=NotificationType.ADMIN_ORG_VERIFICATION).first()
    assert log is not None
    assert organization.name in log.body
    assert organizer.email in log.body


# --- it dedupes a redelivery, but not a resubmission ------------------------


@pytest.mark.django_db
def test_a_redelivered_event_alerts_once(ops, event):
    """The outbox is at-least-once. Two deliveries of one submission are one
    alert."""
    payload = _event_payload(event)
    handlers.handle_event_submitted_for_review(payload)
    handlers.handle_event_submitted_for_review(payload)

    assert (
        NotificationLog.objects.filter(type=NotificationType.ADMIN_EVENT_REVIEW).count() == 2
    )  # one per operator, not two per operator


@pytest.mark.django_db
def test_a_resubmission_alerts_again(ops, event):
    """THE CASE A NAIVE KEY SWALLOWS. An event rejected and resubmitted is a
    new decision; keyed on the event id alone the ledger would call it a
    duplicate and tell nobody. `version` is bumped by every submission, which
    is what makes the key per-SUBMISSION."""
    handlers.handle_event_submitted_for_review(_event_payload(event))
    first = NotificationLog.objects.filter(type=NotificationType.ADMIN_EVENT_REVIEW).count()

    # What submit_for_review_if_draft does to the row on a resubmission.
    Event.objects.filter(pk=event.id).update(version=F("version") + 1)
    handlers.handle_event_submitted_for_review(_event_payload(event))

    assert (
        NotificationLog.objects.filter(type=NotificationType.ADMIN_EVENT_REVIEW).count()
        == first * 2
    )


@pytest.mark.django_db
def test_a_second_verification_request_alerts_again(ops, organization):
    """Same rule for organizations, discriminated by the verification row's own
    id rather than by a version."""
    base = {"organization_id": str(organization.id), "name": organization.name}
    handlers.handle_organization_verification_submitted({**base, "verification_id": "v-1"})
    handlers.handle_organization_verification_submitted({**base, "verification_id": "v-1"})
    handlers.handle_organization_verification_submitted({**base, "verification_id": "v-2"})

    logs = NotificationLog.objects.filter(type=NotificationType.ADMIN_ORG_VERIFICATION)
    assert logs.count() == len(OPS) * 2  # two decisions, two operators


# --- it skips cleanly when nobody is configured -----------------------------


@pytest.mark.django_db
def test_no_configured_operator_means_no_alert_and_no_failure(
    settings, event, django_assert_num_queries
):
    """Refuse rather than pretend, and never at the organiser's expense: an
    unconfigured ops mailbox costs the alert, not the submission.

    And it costs NOTHING ELSE — zero queries. The recipient check runs before
    the handler reads anything, so a platform with no ops mailbox does not pay
    a row load per submission to build a message nobody will receive."""
    settings.PLATFORM_ADMIN_EMAILS = []

    with django_assert_num_queries(0):
        handlers.handle_event_submitted_for_review(_event_payload(event))  # must not raise

    assert not NotificationLog.objects.filter(type=NotificationType.ADMIN_EVENT_REVIEW).exists()


@pytest.mark.django_db
def test_a_blank_env_entry_is_not_a_recipient(settings, event):
    """`PLATFORM_ADMIN_EMAILS=` parses to `['']`. An empty address would claim a
    row and skip the send, which looks identical to a configured operator who
    never received anything."""
    settings.PLATFORM_ADMIN_EMAILS = ["", "   "]

    handlers.handle_event_submitted_for_review(_event_payload(event))

    assert not NotificationLog.objects.filter(type=NotificationType.ADMIN_EVENT_REVIEW).exists()


@pytest.mark.django_db
def test_no_site_url_omits_the_button_rather_than_linking_nowhere(settings, event):
    settings.PLATFORM_ADMIN_EMAILS = list(OPS)
    settings.PUBLIC_SITE_URL = ""

    handlers.handle_event_submitted_for_review(_event_payload(event))

    log = NotificationLog.objects.filter(type=NotificationType.ADMIN_EVENT_REVIEW).first()
    assert log is not None
    assert "/admin/moderation" not in log.body
    assert "/admin/moderation" not in log.html_body
    assert event.title in log.body  # the facts still arrive


@pytest.mark.django_db
def test_a_deleted_event_still_alerts(ops, organization):
    """The version load only SHARPENS the dedupe key. A row that has gone away
    since the submission degrades to one alert per event — never to silence."""
    from apps.events.repositories import EventRepository

    ghost = EventRepository().create(
        organization_id=organization.id,
        title="Vanishing Fest",
        venue="Nowhere",
        city="Mumbai",
        starts_at=timezone.now() + timedelta(days=5),
    )
    Event.objects.filter(pk=ghost.id).update(deleted_at=timezone.now())

    handlers.handle_event_submitted_for_review(_event_payload(ghost))

    logs = list(NotificationLog.objects.filter(type=NotificationType.ADMIN_EVENT_REVIEW))
    assert len(logs) == len(OPS)
    assert "Vanishing Fest" in logs[0].body


# --- the alert is not addressed to the organizer ----------------------------


@pytest.mark.django_db
def test_the_alert_goes_to_operators_only(ops, event):
    """The organiser already knows they submitted it. This message exists for
    the person who has to decide, and mailing it to the submitter would be the
    platform telling them their own news."""
    handlers.handle_event_submitted_for_review(_event_payload(event, owner_email=OPS[0]))

    recipients = set(
        NotificationLog.objects.filter(type=NotificationType.ADMIN_EVENT_REVIEW).values_list(
            "recipient", flat=True
        )
    )
    assert recipients == set(OPS)


@pytest.mark.django_db
def test_a_missing_organization_row_still_produces_a_usable_alert(ops):
    """Nothing to fill in, so the alert says what it knows and links to the
    queue. Silence here would be the one outcome an operator cannot recover
    from."""
    handlers.handle_organization_verification_submitted(
        {"organization_id": "22222222-2222-2222-2222-222222222222", "verification_id": "v-9"}
    )

    log = NotificationLog.objects.filter(type=NotificationType.ADMIN_ORG_VERIFICATION).first()
    assert log is not None
    assert "22222222-2222-2222-2222-222222222222" in log.body
    assert f"{SITE}/admin/verifications" in log.body


@pytest.mark.django_db
def test_the_operator_does_not_need_an_account(ops):
    """PLATFORM_ADMIN_EMAILS is configuration, not a User query. An ops mailbox
    (`ops@`, an alias, a ticketing system) is usually not a person who can sign
    in, and deriving recipients from `is_staff` would silently change who is
    told every time somebody's role changes."""
    assert not UserRepository().get_by_email(OPS[0])
    assert handlers._platform_admin_emails() == OPS


# --- publisher and subscriber must name the same event ----------------------


@pytest.mark.django_db
def test_the_alert_handler_is_actually_subscribed_to_what_organizations_publishes(
    ops, organization, organizer
):
    """THE ONE FAILURE NO OTHER TEST IN THIS FILE CAN SEE.

    Every test above calls a handler DIRECTLY, so all of them pass whether or
    not that handler is subscribed to the string the publisher actually emits.
    Wiring is what breaks here, and it breaks silently: publisher and
    subscriber each resolved this event name with
    `getattr(core.events, ..., "<literal>")`, carrying their own copy of the
    fallback, and the alert fired only because the two literals happened to
    agree. A typo on either side raises nothing — the in-process bus simply has
    no subscriber for the published string and `publish` iterates an empty
    list. The organiser sees "pending review", the operator is told nothing,
    and the submission sits forever with a green test suite.

    So assert the real thing, through the bus rather than by calling the
    handler: publish the constant the publisher publishes, and require that an
    alert comes out the other end.
    """
    from apps.organizations import services as org_services
    from config.di import event_bus_port
    from core import events as core_events

    declared = core_events.ORGANIZATION_VERIFICATION_SUBMITTED
    # It follows the "<module>.<event>" convention every other type uses.
    assert declared == "organizations.organization_verification_submitted"

    # The publisher binds to the declaration rather than to a copy of it.
    assert org_services.ORGANIZATION_VERIFICATION_SUBMITTED is declared

    # And AppConfig.ready() subscribed the handler under that same string, so
    # publishing it reaches an operator. Driven through the bus's public
    # publish() — the bus swallows handler exceptions, so "an alert row exists"
    # is the only honest evidence that the wiring holds.
    event_bus_port().publish(
        declared,
        {
            "organization_id": str(organization.id),
            "verification_id": "wiring-1",
            "name": organization.name,
            "owner_email": organizer.email,
        },
    )

    logs = NotificationLog.objects.filter(type=NotificationType.ADMIN_ORG_VERIFICATION)
    assert sorted(log.recipient for log in logs) == sorted(ops)
