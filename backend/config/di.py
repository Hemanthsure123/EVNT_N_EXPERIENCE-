"""Composition root.

This is the ONLY place in the codebase allowed to know which concrete
adapter backs each port, and the ONLY place that wires a service to its
repositories/ports. Everything else — views, services, tests — depends on
abstractions (ports, repository classes) and gets its instances from the
factory functions here.

Adapter modules are imported lazily, inside each factory function, so
selecting `PAYMENTS_BACKEND=fake` never even attempts to import the
razorpay SDK. Each port's adapter is cached for the process lifetime via
`lru_cache` — this is a performance detail (build a Redis client once, not
per-request), not a hidden global dependency: business code never reaches
for these caches directly, it always goes through a factory call.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import TYPE_CHECKING

from django.conf import settings

from core.ports.cache_port import CachePort
from core.ports.calendar_port import CalendarPort
from core.ports.email_port import EmailPort
from core.ports.event_bus_port import EventBusPort
from core.ports.maps_port import MapsPort
from core.ports.oidc_port import OidcPort
from core.ports.payment_port import PaymentPort
from core.ports.push_port import PushPort
from core.ports.sms_port import SmsPort
from core.ports.storage_port import StoragePort
from core.ports.task_queue_port import TaskQueuePort

if TYPE_CHECKING:
    from apps.accounts.services import (
        AccountAdminService,
        AuthService,
        EmailVerificationService,
        GoogleSignInService,
        ProfileService,
    )
    from apps.announcements.services import AnnouncementService
    from apps.booking.services import BookingService
    from apps.checkin.services import CheckinService
    from apps.cms.services import HomepageService
    from apps.events.services import (
        EventContentService,
        EventModerationService,
        EventService,
    )
    from apps.notifications.services import NotificationService, ReminderService
    from apps.organizations.services import OrganizationFollowService, OrganizationService
    from apps.payments.services import PaymentService, RefundRequestService
    from apps.performers.services import (
        MarketplaceService,
        PerformerModerationService,
        PerformerService,
    )
    from apps.reviews.services import ReviewService
    from apps.settlements.services import SettlementService
    from apps.support.services import SupportService
    from apps.ticketing.services import TicketingService


logger = logging.getLogger(__name__)


# --- Port factories -------------------------------------------------------


@lru_cache(maxsize=4)
def payment_port(gateway: str = "") -> PaymentPort:
    """The adapter for one payment gateway.

    ── WHY THIS TAKES AN ARGUMENT NOW ────────────────────────────────────────

    It used to be `@lru_cache(maxsize=1)` over `PAYMENTS_BACKEND`, which was
    exactly right while one process meant one provider. With a second checkout
    gateway that assumption breaks in a specific and dangerous way: the gateway
    that took a payment is a fact about the BOOKING, not about the deployment.
    A webhook arriving from Cashfree must be verified with Cashfree's scheme
    and secret; a refund for a Razorpay-collected booking must go to Razorpay,
    whatever the default happens to be that week. Resolving the provider from
    settings at those moments would mean refunding through a gateway that never
    took the money.

    So every path that acts on an EXISTING payment passes the gateway stored on
    the row (`Booking.payment_gateway`), and only the initial checkout is free
    to choose.

    ── AND WHY THE NO-ARG CALL IS UNCHANGED ──────────────────────────────────

    `payment_port()` still means `PAYMENTS_BACKEND`, and that is what
    `organizations` and `settlements` are given. Those two are about the
    platform's Route relationship — linked accounts, on-hold transfers, payout
    release — which belongs to ONE provider and cannot be per booking. Widening
    them would mean asking Cashfree to release a payout to a Razorpay linked
    account id.

    Cached per gateway name (`maxsize=4`, comfortably more than the three names
    that exist) — one instance per gateway per process, never a bare global.
    """
    backend = gateway or settings.PAYMENTS_BACKEND
    if backend == "fake":
        from core.adapters.local.fake_payment import FakePaymentAdapter

        # The fake still verifies webhook signatures for real (pure HMAC), so
        # it needs the same secret production uses.
        return FakePaymentAdapter(webhook_secret=settings.RAZORPAY_WEBHOOK_SECRET)
    if backend == "razorpay":
        from core.adapters.razorpay.adapter import RazorpayPaymentAdapter

        return RazorpayPaymentAdapter(
            key_id=settings.RAZORPAY_KEY_ID,
            key_secret=settings.RAZORPAY_KEY_SECRET,
            webhook_secret=settings.RAZORPAY_WEBHOOK_SECRET,
        )
    if backend == "cashfree":
        from core.adapters.cashfree.adapter import CashfreePaymentAdapter

        return CashfreePaymentAdapter(
            app_id=settings.CASHFREE_APP_ID,
            secret_key=settings.CASHFREE_SECRET_KEY,
            environment=settings.CASHFREE_ENVIRONMENT,
        )
    raise ValueError(f"Unknown payments gateway: {backend!r}")


@lru_cache(maxsize=1)
def route_payment_port() -> PaymentPort:
    """The gateway that holds LINKED ACCOUNTS and releases PAYOUTS.

    ── WHY THIS IS NOT `payment_port()` ──────────────────────────────────────

    `organizations` and `settlements` used to be handed `payment_port()`, which
    meant the payout relationship silently followed `PAYMENTS_BACKEND`. That
    was correct while one provider did everything, and it is a trap the moment
    a second gateway exists: flipping the default backend to Cashfree would
    have pointed `release_payout` at a provider that has never heard of the
    Razorpay linked-account id stored in `organizations.payout_account_id`, and
    nothing would have reported it until a real settlement failed — weeks after
    the event, on money an organizer is owed.

    Taking a payment is a per-booking decision. Paying an organizer is not: a
    linked account is a vendor record created ONCE, and the id in our own
    database belongs to exactly one provider. So the two are now separate
    settings, and this one is explicit.

    Defaults to `PAYMENTS_BACKEND`, so nothing changes for a deployment that
    never sets it.
    """
    return payment_port(str(settings.PAYMENTS_ROUTE_PROVIDER or settings.PAYMENTS_BACKEND))


#: What each gateway needs before it may be offered. A gateway whose
#: credentials are absent is DROPPED from the selector rather than shown and
#: then failing at the press — see `enabled_payment_gateways`.
_GATEWAY_CREDENTIALS: dict[str, tuple[str, ...]] = {
    "razorpay": ("RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"),
    "cashfree": ("CASHFREE_APP_ID", "CASHFREE_SECRET_KEY"),
    # The fake needs nothing, and is never listed beside a real gateway (see
    # below) — a demo option next to a live one is a "pay nothing" button.
    "fake": (),
}


def _gateway_is_usable(name: str) -> bool:
    if name not in _GATEWAY_CREDENTIALS:
        return False
    return all(str(getattr(settings, key, "") or "") for key in _GATEWAY_CREDENTIALS[name])


@lru_cache(maxsize=1)
def enabled_payment_gateways() -> tuple[tuple[str, ...], str]:
    """`(offerable gateway names, the default)` — the ONE place that decides
    what a checkout may present.

    Four rules, and each exists because the alternative is a checkout that
    lies:

    1. **A fake default means a fake deployment, full stop.** When
       `PAYMENTS_BACKEND=fake` the answer is `(("fake",), "fake")` and no
       selector is drawn, whatever `PAYMENTS_ENABLED_GATEWAYS` says. Offering
       a choice between "Cashfree" and a simulated payment on the same screen
       is offering a pay-nothing button; `PaymentSection` already refuses to
       render provider branding in demo mode for the same reason.

    2. **Unconfigured gateways are dropped, not displayed.** A name listed
       without its credentials would render a logo, take the press, and fail
       when the order call got a 401.

    3. **`PAYMENTS_BACKEND` is always in the set.** It is the provider the rest
       of the platform is built around, and a deployment that lists only
       Cashfree still refunds and settles through Razorpay.

    4. **The default must be offerable.** A `PAYMENTS_DEFAULT_GATEWAY` that is
       not usable falls back to the first that is, rather than pre-selecting a
       gateway whose button cannot work.
    """
    backend = str(settings.PAYMENTS_BACKEND)
    if backend == "fake":
        return ("fake",), "fake"

    names: list[str] = []
    for candidate in [backend, *settings.PAYMENTS_ENABLED_GATEWAYS]:
        name = str(candidate).strip().lower()
        # "fake" can never join a live set — see rule 1.
        if not name or name == "fake" or name in names:
            continue
        if not _gateway_is_usable(name):
            logger.warning(
                "payments.gateway_not_offered",
                extra={"gateway": name, "reason": "missing credentials"},
            )
            continue
        names.append(name)

    if not names:
        # Nothing is configured. Returning the backend anyway is deliberate:
        # the booking still gets made and `PaymentSection` renders its
        # "payment provider not configured" notice, which is a far better
        # outcome than a 500 on reserve.
        return (backend,), backend

    preferred = str(settings.PAYMENTS_DEFAULT_GATEWAY or "").strip().lower()
    default = preferred if preferred in names else names[0]
    return tuple(names), default


def resolve_payment_gateway(requested: str) -> str:
    """The gateway to actually use for a NEW order, given what the client asked
    for.

    The client's value is a REQUEST, never an instruction: anything not in the
    offerable set falls back to the default rather than raising. A checkout
    that 400s because a browser sent a stale gateway name — one this deployment
    used to offer, cached in somebody's tab — would refuse a sale over a
    presentational detail the customer cannot see and could not have chosen.
    """
    names, default = enabled_payment_gateways()
    wanted = str(requested or "").strip().lower()
    return wanted if wanted in names else default


@lru_cache(maxsize=1)
def storage_port() -> StoragePort:
    backend = settings.STORAGE_BACKEND
    if backend == "local":
        from core.adapters.local.local_storage import LocalStorageAdapter

        return LocalStorageAdapter()
    if backend == "gcs":
        from core.adapters.gcs.adapter import GCSStorageAdapter

        return GCSStorageAdapter(
            bucket_name=settings.GCS_BUCKET_NAME, project_id=settings.GCP_PROJECT_ID
        )
    if backend == "s3":
        # Supabase Storage, Cloudflare R2, AWS S3 or MinIO — one protocol,
        # one adapter, and only the endpoint distinguishes them.
        from core.adapters.s3.adapter import S3StorageAdapter

        return S3StorageAdapter(
            bucket_name=settings.S3_BUCKET_NAME,
            endpoint_url=settings.S3_ENDPOINT_URL,
            access_key_id=settings.S3_ACCESS_KEY_ID,
            secret_access_key=settings.S3_SECRET_ACCESS_KEY,
            region=settings.S3_REGION,
            public_base_url=settings.S3_PUBLIC_BASE_URL,
        )
    raise ValueError(f"Unknown STORAGE_BACKEND: {backend!r}")


@lru_cache(maxsize=1)
def cache_port() -> CachePort:
    backend = settings.CACHE_BACKEND
    if backend == "locmem":
        from core.adapters.local.locmem_cache import LocMemCacheAdapter

        return LocMemCacheAdapter()
    if backend == "redis":
        from core.adapters.redis.adapter import RedisCacheAdapter

        return RedisCacheAdapter(url=settings.REDIS_URL)
    raise ValueError(f"Unknown CACHE_BACKEND: {backend!r}")


@lru_cache(maxsize=1)
def email_port() -> EmailPort:
    backend = settings.EMAIL_PROVIDER
    if backend == "console":
        from core.adapters.local.console_email import ConsoleEmailAdapter

        return ConsoleEmailAdapter()
    if backend == "smtp":
        from core.adapters.smtp.adapter import SmtpEmailAdapter

        return SmtpEmailAdapter(
            host=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USERNAME,
            password=settings.SMTP_PASSWORD,
            from_email=settings.SMTP_FROM_EMAIL,
            use_tls=settings.SMTP_USE_TLS,
            use_ssl=settings.SMTP_USE_SSL,
            timeout_seconds=settings.SMTP_TIMEOUT_SECONDS,
        )
    raise ValueError(f"Unknown EMAIL_PROVIDER: {backend!r}")


@lru_cache(maxsize=1)
def sms_port() -> SmsPort:
    backend = settings.SMS_PROVIDER
    if backend == "console":
        from core.adapters.local.console_sms import ConsoleSmsAdapter

        return ConsoleSmsAdapter()
    if backend == "disabled":
        # An explicit "this deployment does not send SMS", as opposed to
        # `console`, which is a dev fake that production must never run. See
        # the module docstring in core/adapters/local/disabled_sms.py.
        from core.adapters.local.disabled_sms import DisabledSmsAdapter

        return DisabledSmsAdapter()
    if backend == "http":
        from core.adapters.sms_provider.adapter import HttpSmsAdapter

        return HttpSmsAdapter(
            api_key=settings.SMS_API_KEY,
            sender_id=settings.SMS_SENDER_ID,
            dlt_entity_id=settings.SMS_DLT_ENTITY_ID,
            dlt_template_id=settings.SMS_DLT_TEMPLATE_ID,
            api_base_url=settings.SMS_API_BASE_URL,
        )
    raise ValueError(f"Unknown SMS_PROVIDER: {backend!r}")


@lru_cache(maxsize=1)
def push_port() -> PushPort:
    """Web Push.

    Unlike every other port here there is no vendor to choose — Web Push is a
    standard, the browser names its own push service, and the credential is a
    VAPID key pair we generate ourselves (`manage.py generate_vapid_keys`).
    So the only real decision is configured vs not.

    With no keys this returns the DISABLED adapter, which reports
    `is_configured() == False` and refuses to send. That is deliberately not a
    console/fake adapter: everything upstream asks before offering the feature,
    so an unconfigured deployment tells the user push is unavailable instead of
    collecting subscriptions and logging "sent!" to a terminal nobody reads.
    """
    from core.adapters.webpush.adapter import DisabledPushAdapter, WebPushAdapter

    if settings.PUSH_BACKEND != "webpush":
        raise ValueError(f"Unknown PUSH_BACKEND: {settings.PUSH_BACKEND!r}")
    if not (settings.VAPID_PUBLIC_KEY and settings.VAPID_PRIVATE_KEY):
        return DisabledPushAdapter()

    # ── A HALF-CONFIGURED OPTIONAL CHANNEL MUST NOT TAKE DOWN SIGN-IN ────
    #
    # `WebPushAdapter` REQUIRES a contact (the VAPID `sub` claim; push services
    # reject a token without one) and raises when it is missing. This factory
    # used to let that raise escape, and the blast radius was nothing like
    # "push is broken":
    #
    #   /auth/oauth/google/signin/config
    #     -> build_google_sign_in_service -> build_auth_service
    #     -> build_email_verification_service -> build_notification_service
    #     -> push_port() -> ValueError -> 500
    #
    # `build_notification_service` holds every channel, and it sits on the path
    # of email verification, which sits on the path of Google sign-in. So VAPID
    # keys added without `VAPID_CONTACT` returned 500 from the sign-in config
    # endpoint, the panel showed "we can't reach the sign-in service", and the
    # cause was a push setting nobody had connected to authentication.
    #
    # Push is OPTIONAL and sign-in is not. So an incomplete configuration
    # degrades to the disabled adapter — the same state the deployment was in
    # before the keys were added, which is known-good — and is logged at ERROR
    # so it is never silent. This is the rule `RedisCacheAdapter` already
    # follows and the one `/health/` learned: a non-essential dependency may
    # make the product smaller, never make it refuse.
    #
    # `core/preflight.py` REFUSES this configuration at boot, so on a
    # production deploy it is caught before serving rather than degraded
    # forever. The two together are the SMS_PROVIDER=disabled shape: loud at
    # boot, safe at runtime.
    if not settings.VAPID_CONTACT:
        logger.error(
            "push.disabled_incomplete_config",
            extra={
                "reason": "VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are set but "
                "VAPID_CONTACT is empty. Web Push is DISABLED. Set "
                "VAPID_CONTACT to a mailto: or https URL a push service can "
                "reach you at."
            },
        )
        return DisabledPushAdapter()

    return WebPushAdapter(
        public_key=settings.VAPID_PUBLIC_KEY,
        private_key=settings.VAPID_PRIVATE_KEY,
        contact=settings.VAPID_CONTACT,
    )


@lru_cache(maxsize=1)
def maps_port() -> MapsPort:
    """Google Maps Platform.

    ONE key for every Maps service — that is Google's model, and one key is
    one quota, one bill and one rotation. With it unset this returns the
    DISABLED adapter, which refuses every call rather than returning invented
    coordinates: a made-up marker would put an event at a building nobody is
    performing in, which is worse than no map at all.
    """
    from core.adapters.google_maps.adapter import DisabledMapsAdapter, GoogleMapsAdapter

    if not settings.GOOGLE_MAPS_API_KEY:
        return DisabledMapsAdapter()
    return GoogleMapsAdapter(
        api_key=settings.GOOGLE_MAPS_API_KEY,
        region=settings.GOOGLE_MAPS_REGION,
    )


@lru_cache(maxsize=1)
def calendar_port() -> CalendarPort:
    """Google Calendar, over the ONE shared OAuth client.

    No second client: Google issues one per application, and a second would
    mean a second consent screen and a second verification review. Calendar
    simply asks for its own scopes on top.

    Unconfigured returns the DISABLED adapter — `is_configured()` is False,
    the connect endpoint answers 503, and the UI does not offer the button.
    """
    from core.adapters.google_calendar.adapter import (
        DisabledCalendarAdapter,
        GoogleCalendarAdapter,
    )

    if not (settings.GOOGLE_OAUTH_CLIENT_ID and settings.GOOGLE_OAUTH_CLIENT_SECRET):
        return DisabledCalendarAdapter()
    return GoogleCalendarAdapter(
        client_id=settings.GOOGLE_OAUTH_CLIENT_ID,
        client_secret=settings.GOOGLE_OAUTH_CLIENT_SECRET,
    )


@lru_cache(maxsize=1)
def event_bus_port() -> EventBusPort:
    backend = settings.EVENT_BUS_BACKEND
    if backend == "inprocess":
        from core.adapters.local.inprocess_event_bus import InProcessEventBusAdapter

        return InProcessEventBusAdapter()
    if backend == "pubsub":
        from core.adapters.pubsub.adapter import PubSubEventBusAdapter

        return PubSubEventBusAdapter(
            project_id=settings.GCP_PROJECT_ID, topic_name=settings.PUBSUB_TOPIC_EVENTS
        )
    raise ValueError(f"Unknown EVENT_BUS_BACKEND: {backend!r}")


@lru_cache(maxsize=1)
def task_queue_port() -> TaskQueuePort:
    backend = settings.QUEUE_BACKEND
    if backend == "local":
        from core.adapters.local.sync_task_queue import SyncTaskQueueAdapter

        return SyncTaskQueueAdapter()
    if backend == "cloud_tasks":
        from core.adapters.cloud_tasks.adapter import CloudTasksQueueAdapter

        # `target_url` is this service's own `/internal/tasks/run`
        # (core/task_dispatch.py). The shared secret travels as a header on
        # every enqueued task, because the endpoint runs registered handlers by
        # name and one of them releases a payout. Preflight refuses to boot if
        # either is missing while this backend is selected.
        return CloudTasksQueueAdapter(
            project_id=settings.GCP_PROJECT_ID,
            location=settings.CLOUD_TASKS_LOCATION,
            queue=settings.CLOUD_TASKS_QUEUE,
            target_url=settings.CLOUD_TASKS_TARGET_URL,
            shared_secret=settings.INTERNAL_TASK_SECRET,
            service_account_email=settings.CLOUD_TASKS_SERVICE_ACCOUNT,
        )
    raise ValueError(f"Unknown QUEUE_BACKEND: {backend!r}")


# --- Service factories ------------------------------------------------
# One function per application service. As new modules are added, their
# service factories are added here too — this file is the single place that
# ever imports both a repository and an adapter side by side.


def build_support_service() -> SupportService:
    """Support queries.

    No ports: this module writes two tables and reads them back. Notifying the
    other side goes through `apps.notifications` on the outbox, so there is no
    email or queue dependency to inject here.
    """
    from apps.support.repositories import SupportRepository
    from apps.support.services import SupportService

    return SupportService(queries=SupportRepository())


def build_review_service() -> ReviewService:
    """Post-event reviews.

    Takes the EVENT repository as well as its own: `Event.rating_sum` /
    `rating_count` are denormalised counters this module owns and writes
    through `EventRepository.apply_rating_delta`, the same arrangement
    `ticketing` has for `from_price_minor`. Injected rather than imported at
    call time so the service stays constructible in a unit test without
    Django settings deciding anything.
    """
    from apps.events.repositories import EventRepository
    from apps.reviews.repositories import ReviewRepository
    from apps.reviews.services import ReviewService

    return ReviewService(reviews=ReviewRepository(), events=EventRepository())


def build_auth_service() -> AuthService:
    from apps.accounts.repositories import UserRepository
    from apps.accounts.services import AuthService

    return AuthService(
        users=UserRepository(),
        email=email_port(),
        task_queue=task_queue_port(),
        # Registration issues a verification code as part of the same call,
        # so the composition root wires it here rather than leaving the view
        # to orchestrate two services.
        verification=build_email_verification_service(),
    )


def build_email_verification_service() -> EmailVerificationService:
    """Issuing and checking the registration code.

    Its own factory rather than a method on the auth service: it needs the
    NOTIFICATION service (which auth does not) and none of the token
    machinery, so composing it separately keeps each dependency list honest
    about what its class actually uses.
    """
    from apps.accounts.repositories import EmailVerificationRepository, UserRepository
    from apps.accounts.services import EmailVerificationService

    return EmailVerificationService(
        users=UserRepository(),
        verifications=EmailVerificationRepository(),
        notifications=build_notification_service(),
    )


@lru_cache(maxsize=1)
def oidc_port() -> OidcPort:
    """Google as an identity provider.

    Unconfigured returns the DISABLED adapter rather than a fake: the sign-in
    endpoint then answers 503 and the UI hides the button, instead of offering
    a control that fails only after a round trip to Google. Same
    refuse-rather-than-pretend rule as push.
    """
    from core.adapters.google_oidc.adapter import DisabledOidcAdapter, GoogleOidcAdapter

    if not (settings.GOOGLE_OAUTH_CLIENT_ID and settings.GOOGLE_OAUTH_CLIENT_SECRET):
        return DisabledOidcAdapter()
    return GoogleOidcAdapter(
        client_id=settings.GOOGLE_OAUTH_CLIENT_ID,
        client_secret=settings.GOOGLE_OAUTH_CLIENT_SECRET,
    )


def build_google_sign_in_service() -> GoogleSignInService:
    from apps.accounts.repositories import UserRepository
    from apps.accounts.services import GoogleSignInService

    # No `cache=`. The OAuth state and the handoff live in Postgres
    # (`core.ephemeral`) because a degraded cache silently broke every
    # sign-in in production while `/health/` stayed green — see
    # `core.models.EphemeralToken`.
    return GoogleSignInService(
        users=UserRepository(),
        oidc=oidc_port(),
        auth=build_auth_service(),
        redirect_uri=settings.GOOGLE_OAUTH_SIGNIN_REDIRECT_URI,
    )


def build_profile_service() -> ProfileService:
    """What an account holder changes about their OWN profile.

    Its own factory rather than a method on the auth service: it needs
    `StoragePort` (which auth does not) and none of the token machinery, so
    composing it separately keeps each dependency list honest — and it is the
    same split `AccountAdminService` exists for, one level down. Everything on
    the auth service acts for the account holder's SESSION; everything here
    acts on their profile.
    """
    from apps.accounts.repositories import UserRepository
    from apps.accounts.services import ProfileService

    return ProfileService(users=UserRepository(), storage=storage_port())


def build_account_admin_service() -> AccountAdminService:
    """A platform operator's actions on somebody else's account.

    Its own factory rather than a method on the auth service, mirroring
    `build_event_moderation_service` — the two answer different authorization
    questions and are constructed for different callers.
    """
    from apps.accounts.repositories import UserRepository
    from apps.accounts.services import AccountAdminService

    return AccountAdminService(users=UserRepository())


def build_performer_service() -> PerformerService:
    """An owner's actions on their own performer profiles."""
    from apps.organizations.repositories import OrganizationRepository
    from apps.performers.repositories import PerformerMediaRepository, PerformerRepository
    from apps.performers.services import PerformerService

    return PerformerService(
        performers=PerformerRepository(),
        media=PerformerMediaRepository(),
        organizations=OrganizationRepository(),
        storage=storage_port(),
    )


def build_performer_moderation_service() -> PerformerModerationService:
    """A platform operator's decisions on submitted profiles. Its own factory
    rather than a method on the owner service, mirroring
    `build_event_moderation_service` — the two answer different authorization
    questions and are built for different callers."""
    from apps.accounts.repositories import UserRepository
    from apps.performers.repositories import PerformerRepository
    from apps.performers.services import PerformerModerationService

    return PerformerModerationService(performers=PerformerRepository(), users=UserRepository())


def build_marketplace_service() -> MarketplaceService:
    """The enquiry desk: a customer's requirement, and an operator working it."""
    from apps.accounts.repositories import UserRepository
    from apps.performers.repositories import (
        BookingRequestRepository,
        PerformerRepository,
        QuoteRepository,
    )
    from apps.performers.services import MarketplaceService

    return MarketplaceService(
        requests=BookingRequestRepository(),
        quotes=QuoteRepository(),
        performers=PerformerRepository(),
        # For the contact-detail fallback: an enquiry with no way to answer it
        # is one that wastes both people's time, and the account always has an
        # email address.
        users=UserRepository(),
    )


def build_organization_service() -> OrganizationService:
    from apps.accounts.repositories import UserRepository
    from apps.organizations.repositories import OrganizationRepository
    from apps.organizations.services import OrganizationService

    return OrganizationService(
        organizations=OrganizationRepository(),
        users=UserRepository(),
        storage=storage_port(),
        # The ROUTE provider, not the default: `create_linked_account` writes a
        # vendor record whose id is stored on the organization, and a payout is
        # later released against THAT vendor.
        payments=route_payment_port(),
        task_queue=task_queue_port(),
    )


def build_organization_follow_service() -> OrganizationFollowService:
    """Following an organizer. Repositories only — no ports — so this is the
    whole of its composition."""
    from apps.organizations.repositories import (
        OrganizationFollowRepository,
        OrganizationRepository,
    )
    from apps.organizations.services import OrganizationFollowService

    return OrganizationFollowService(
        follows=OrganizationFollowRepository(), organizations=OrganizationRepository()
    )


def build_announcement_service() -> AnnouncementService:
    """Platform announcements. Staff-only; the view enforces that."""
    from apps.announcements.repositories import AnnouncementRepository
    from apps.announcements.services import AnnouncementService

    return AnnouncementService(announcements=AnnouncementRepository())


def build_homepage_service() -> HomepageService:
    """Admin-authored homepage content. Staff-only; the view enforces that."""
    from apps.cms.repositories import (
        CategoryRepository,
        FeaturedCityRepository,
        FeaturedRepository,
        HomepageRepository,
        PopularSearchRepository,
    )
    from apps.cms.services import HomepageService

    return HomepageService(
        homepage=HomepageRepository(),
        featured=FeaturedRepository(),
        categories=CategoryRepository(),
        cities=FeaturedCityRepository(),
        popular=PopularSearchRepository(),
    )


def build_event_content_service() -> EventContentService:
    """Media, FAQs and running order. Ownership is checked in the service."""
    from apps.events.repositories import (
        CrewMemberRepository,
        EventContentRepository,
        EventCrewRepository,
        EventRepository,
        EventSlotRepository,
    )
    from apps.events.services import EventContentService

    return EventContentService(
        events=EventRepository(),
        content=EventContentRepository(),
        storage=storage_port(),
        slots=EventSlotRepository(),
        crew=CrewMemberRepository(),
        lineups=EventCrewRepository(),
    )


def build_crew_service():
    """An organization's crew roster.

    Its own factory rather than a method on the content service, because it is
    authorised by the ORGANIZATION's owner while everything there is authorised
    by an EVENT's owner — two different answers to "who may do this" have no
    business sharing a class.
    """
    from apps.events.repositories import CrewMemberRepository
    from apps.events.services import CrewService
    from apps.organizations.repositories import OrganizationRepository

    return CrewService(
        organizations=OrganizationRepository(),
        crew=CrewMemberRepository(),
        storage=storage_port(),
    )


def build_organizer_category_service():
    """An organization's own category labels.

    Its own factory beside `build_crew_service` above, for the identical
    reason: it is authorised by the ORGANIZATION's owner, where everything on
    the content service is authorised by an EVENT's owner.

    `storage_port()` is injected because a custom category can carry a
    picture, and the URL written to `image_url` must be one the adapter
    returned rather than a string a client handed us.
    """
    from apps.events.repositories import OrganizerCategoryRepository
    from apps.events.services import OrganizerCategoryService
    from apps.organizations.repositories import OrganizationRepository

    return OrganizerCategoryService(
        organizations=OrganizationRepository(),
        categories=OrganizerCategoryRepository(),
        storage=storage_port(),
    )


def build_coupon_service():
    """An organization's promotional codes — the ORGANIZER's half.

    Its own factory, and separate from `build_coupon_redemption_service` below,
    because the two services answer to two different people: this one is
    authorised by the organization's owner, that one acts for a customer at a
    checkout. Same reason `build_crew_service` is not a method on the content
    service.
    """
    from apps.coupons.repositories import CouponRedemptionRepository, CouponRepository
    from apps.coupons.services import CouponService
    from apps.events.repositories import EventRepository
    from apps.organizations.repositories import OrganizationRepository

    return CouponService(
        organizations=OrganizationRepository(),
        coupons=CouponRepository(),
        redemptions=CouponRedemptionRepository(),
        events=EventRepository(),
    )


def build_coupon_redemption_service():
    """The CHECKOUT's half: redeem a code onto a booking, and give it back.

    Constructed by `build_booking_service` and called from inside the booking's
    own transaction, which is why it takes no ports — every decision it makes
    is a database one, under a lock the caller already opened a transaction
    for.
    """
    from apps.coupons.repositories import CouponRedemptionRepository, CouponRepository
    from apps.coupons.services import CouponRedemptionService
    from apps.events.repositories import EventRepository

    return CouponRedemptionService(
        coupons=CouponRepository(),
        redemptions=CouponRedemptionRepository(),
        events=EventRepository(),
    )


def build_waitlist_service():
    """The waiting list for a sold-out event.

    The notifier is passed as the `NotificationService` itself, which satisfies
    `events.WaitlistNotifier` structurally — the dependency is one-way and
    explicit (events asks notifications to send; nothing in notifications knows
    this list exists), exactly as `build_announcement_broadcast_service` wires
    the same protocol.
    """
    from apps.events.repositories import EventRepository, EventWaitlistRepository
    from apps.events.services import WaitlistService

    return WaitlistService(
        waitlist=EventWaitlistRepository(),
        events=EventRepository(),
        notifier=build_notification_service(),
    )


def build_event_moderation_service() -> EventModerationService:
    """A platform operator's decisions on submitted events. Staff-only —
    the view enforces that; this service asks no ownership question."""
    from apps.accounts.repositories import UserRepository
    from apps.events.repositories import EventRepository
    from apps.events.services import EventModerationService

    return EventModerationService(events=EventRepository(), users=UserRepository())


def build_event_service() -> EventService:
    from apps.accounts.repositories import UserRepository
    from apps.events.repositories import EventRepository
    from apps.events.services import EventService
    from apps.organizations.repositories import OrganizationRepository

    return EventService(
        events=EventRepository(),
        organizations=OrganizationRepository(),
        users=UserRepository(),
        storage=storage_port(),
        task_queue=task_queue_port(),
    )


def build_ticketing_service() -> TicketingService:
    from apps.events.repositories import EventRepository
    from apps.ticketing.repositories import PricingHistoryRepository, TicketTypeRepository
    from apps.ticketing.services import TicketingService
    from apps.ticketing.strategies import RowLockReservationStrategy

    ticket_types = TicketTypeRepository()
    return TicketingService(
        ticket_types=ticket_types,
        events=EventRepository(),
        reservation=RowLockReservationStrategy(ticket_types=ticket_types),
        history=PricingHistoryRepository(),
    )


def build_booking_service() -> BookingService:
    from apps.booking.repositories import BookingRepository, TicketRepository
    from apps.booking.services import BookingService
    from apps.events.repositories import EventContentRepository, EventRepository
    from apps.ticketing.repositories import TicketTypeRepository

    return BookingService(
        bookings=BookingRepository(),
        tickets=TicketRepository(),
        ticket_types=TicketTypeRepository(),
        ticketing=build_ticketing_service(),
        events=EventRepository(),
        coupons=build_coupon_redemption_service(),
        event_content=EventContentRepository(),
        payments=payment_port(),
        cache=cache_port(),
        qr_secret=settings.TICKET_QR_SIGNING_KEY,
        hold_minutes=settings.BOOKING_HOLD_MINUTES,
        platform_fee_bps=settings.PLATFORM_FEE_BPS,
        donation_max_minor=settings.DONATION_MAX_MINOR,
    )


def build_payment_service() -> PaymentService:
    from apps.booking.repositories import BookingRepository
    from apps.payments.repositories import (
        PaymentRepository,
        ProcessedWebhookRepository,
        RefundRepository,
    )
    from apps.payments.services import PaymentService

    return PaymentService(
        payments=PaymentRepository(),
        refunds=RefundRepository(),
        webhooks=ProcessedWebhookRepository(),
        bookings=BookingRepository(),
        booking_service=build_booking_service(),
        payments_port=payment_port(),
        task_queue=task_queue_port(),
    )


def build_refund_request_service() -> RefundRequestService:
    """The refund-REQUEST workflow, separate from the money path.

    Note what it is NOT given: `PaymentPort`. This service enqueues a refund and
    never performs one, so it has no way to reach a vendor even by accident —
    `PaymentService.execute_refund` stays the single place money moves, with its
    lock, its idempotency and its vendor idempotency key.
    """
    from apps.booking.repositories import BookingRepository
    from apps.payments.repositories import PaymentRepository, RefundRequestRepository
    from apps.payments.services import RefundRequestService

    return RefundRequestService(
        requests=RefundRequestRepository(),
        payments=PaymentRepository(),
        bookings=BookingRepository(),
        task_queue=task_queue_port(),
    )


def build_checkin_service() -> CheckinService:
    from apps.booking.repositories import TicketRepository
    from apps.checkin.repositories import ScanLogRepository
    from apps.checkin.services import CheckinService
    from apps.events.repositories import EventRepository
    from apps.ticketing.repositories import TicketTypeRepository

    return CheckinService(
        scans=ScanLogRepository(),
        tickets=TicketRepository(),
        ticket_types=TicketTypeRepository(),
        events=EventRepository(),
        cache=cache_port(),
        qr_secret=settings.TICKET_QR_SIGNING_KEY,
        window_opens_before_minutes=settings.CHECKIN_WINDOW_OPENS_BEFORE_MINUTES,
        window_grace_after_minutes=settings.CHECKIN_WINDOW_GRACE_AFTER_MINUTES,
    )


def build_notification_service() -> NotificationService:
    from apps.notifications.repositories import (
        NotificationLogRepository,
        PushSubscriptionRepository,
    )
    from apps.notifications.services import NotificationService
    from apps.notifications.templates import TemplateService

    return NotificationService(
        logs=NotificationLogRepository(),
        templates=TemplateService(),
        email=email_port(),
        sms=sms_port(),
        push=push_port(),
        push_subscriptions=PushSubscriptionRepository(),
        task_queue=task_queue_port(),
        max_attempts=settings.NOTIFICATION_MAX_ATTEMPTS,
        retry_backoff_seconds=settings.NOTIFICATION_RETRY_BACKOFF_SECONDS,
    )


def build_reminder_service() -> ReminderService:
    from apps.accounts.repositories import UserRepository
    from apps.booking.repositories import TicketRepository
    from apps.events.repositories import EventRepository
    from apps.notifications.services import ReminderService

    return ReminderService(
        notifications=build_notification_service(),
        tickets=TicketRepository(),
        users=UserRepository(),
        events=EventRepository(),
    )


def build_maps_read_service():
    """Cache-aside reads over the Maps port. Not cached itself — the service
    is a thin wrapper and the ports inside it already are."""
    from apps.maps.selectors import MapsReadService

    return MapsReadService(maps=maps_port(), cache=cache_port())


def build_google_oauth_service():
    from apps.accounts.repositories import UserRepository
    from apps.integrations.repositories import GoogleConnectionRepository
    from apps.integrations.services import GoogleOAuthService

    # No `cache=` — same reason as `build_google_sign_in_service` above.
    return GoogleOAuthService(
        connections=GoogleConnectionRepository(),
        calendar=calendar_port(),
        users=UserRepository(),
        redirect_uri=settings.GOOGLE_OAUTH_REDIRECT_URI,
    )


def build_calendar_sync_service():
    from apps.booking.repositories import BookingRepository
    from apps.events.repositories import EventRepository
    from apps.integrations.repositories import (
        CalendarEventLinkRepository,
        GoogleConnectionRepository,
    )
    from apps.integrations.services import CalendarSyncService

    return CalendarSyncService(
        oauth=build_google_oauth_service(),
        connections=GoogleConnectionRepository(),
        links=CalendarEventLinkRepository(),
        calendar=calendar_port(),
        bookings=BookingRepository(),
        events=EventRepository(),
        task_queue=task_queue_port(),
        site_url=settings.PUBLIC_SITE_URL,
    )


def build_settlement_service() -> SettlementService:
    from apps.events.repositories import EventRepository
    from apps.payments.repositories import PaymentRepository
    from apps.settlements.repositories import PayoutAttemptRepository, SettlementRepository
    from apps.settlements.services import SettlementService

    return SettlementService(
        settlements=SettlementRepository(),
        attempts=PayoutAttemptRepository(),
        payments=PaymentRepository(),
        events=EventRepository(),
        # The ROUTE provider: `release_payout` settles an ON-HOLD transfer to a
        # linked account, and only the provider that issued that account can.
        payments_port=route_payment_port(),
        task_queue=task_queue_port(),
        refund_window_hours=settings.SETTLEMENT_REFUND_WINDOW_HOURS,
        max_attempts=settings.SETTLEMENT_MAX_ATTEMPTS,
        retry_backoff_seconds=settings.SETTLEMENT_RETRY_BACKOFF_SECONDS,
    )


def build_engagement_service():
    """How often events are seen — the beacon behind the organizer's views,
    impressions and click-through. See `apps/events/engagement.py`."""
    from apps.events.engagement import EngagementService
    from apps.events.repositories import EventEngagementRepository

    return EngagementService(engagement=EventEngagementRepository())
