"""Business rules for connecting a Google account and syncing calendars.

Two services, split along the line that matters: `GoogleOAuthService` owns
the GRANT (consent, tokens, revocation) and `CalendarSyncService` owns what
we do with it. Mixing them would mean every calendar write carried the
consent flow's concerns, and the token-refresh lock would be held across a
network call to the Calendar API.

── THE FLOW, AND THE FOUR THINGS THAT MAKE IT SAFE ──────────────────────

1. **`state` is single-use and server-side.** It is a random token stored in
   Redis against the user id, with a short TTL, and CONSUMED on read. A
   replayed callback finds nothing and is rejected. Keeping it server-side
   (rather than signing it into a cookie) also means the callback can
   identify the user without a session — which it must, because the browser
   returns from Google without our Authorization header.

2. **PKCE (S256).** The verifier never leaves this server. An attacker who
   captures the code — from a log, a Referer header, a shared machine — still
   cannot redeem it.

3. **Refresh happens under a row lock.** Two concurrent calendar writes
   would otherwise both refresh, and Google sometimes rotates the refresh
   token, so the second response silently invalidates the first. The lock
   makes exactly one refresh.

4. **A dead grant is terminal, not retryable.** `CalendarAuthError` marks the
   connection `needs_reconnect` and stops. Retrying a revoked token is a
   loop that ends when the retry budget does.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import timedelta

from apps.accounts.repositories import UserRepository
from apps.booking.repositories import BookingRepository
from apps.events.repositories import EventRepository
from core.audit import record_audit
from core.ports.cache_port import CachePort
from core.ports.calendar_port import (
    CalendarAuthError,
    CalendarError,
    CalendarEventDraft,
    CalendarPort,
)
from core.ports.task_queue_port import TaskQueuePort

from .exceptions import (
    CalendarNotConnectedError,
    CalendarReconnectRequiredError,
    CalendarSyncFailedError,
    InsufficientScopeError,
    IntegrationNotConfiguredError,
    OAuthConsentDeniedError,
    OAuthStateInvalidError,
)
from .models import ConnectionStatus, GoogleConnection
from .repositories import CalendarEventLinkRepository, GoogleConnectionRepository

logger = logging.getLogger(__name__)

SYNC_BOOKING_TASK = "integrations.sync_booking_to_calendar"
SYNC_EVENT_TASK = "integrations.sync_event_changes"
CANCEL_EVENT_TASK = "integrations.cancel_event_in_calendars"

CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events"

#: How long the user has to complete Google's consent screen. Ten minutes is
#: generous for a form with two buttons and short enough that an abandoned
#: state does not linger as a redeemable credential.
STATE_TTL_SECONDS = 600

#: Popup reminders on a ticket. A day ahead to plan the evening, two hours to
#: leave the house. Chosen rather than left to the calendar default because a
#: default of "10 minutes before" is useless for an event across a city.
DEFAULT_REMINDERS = (24 * 60, 120)


@dataclass(frozen=True)
class AuthorizationRequest:
    authorization_url: str
    state: str


@dataclass(frozen=True)
class ConnectionResult:
    connection: GoogleConnection
    reconnected: bool


class GoogleOAuthService:
    def __init__(
        self,
        *,
        connections: GoogleConnectionRepository,
        calendar: CalendarPort,
        cache: CachePort,
        users: UserRepository,
        redirect_uri: str,
    ) -> None:
        self._connections = connections
        self._calendar = calendar
        self._cache = cache
        self._users = users
        self._redirect_uri = redirect_uri

    # --- starting the flow ------------------------------------------------

    @staticmethod
    def _pkce_pair() -> tuple[str, str]:
        """Return `(verifier, challenge)` for PKCE S256.

        43–128 characters of base64url per RFC 7636; 32 random bytes lands at
        43, the minimum, which is plenty — it is a nonce, not a key.
        """
        verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
        digest = hashlib.sha256(verifier.encode()).digest()
        challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
        return verifier, challenge

    @staticmethod
    def _state_key(state: str) -> str:
        return f"oauth:google:state:{state}"

    def start_authorization(
        self, *, user_id: uuid.UUID, login_hint: str = ""
    ) -> AuthorizationRequest:
        """Mint the consent URL. Nothing is stored against the user yet."""
        if not self._calendar.is_configured():
            raise IntegrationNotConfiguredError(
                "Google Calendar is not configured on this deployment."
            )

        state = secrets.token_urlsafe(32)
        verifier, challenge = self._pkce_pair()

        # The state entry IS the pending authorization: it binds this callback
        # to this user and to this PKCE verifier. Stored server-side because
        # the callback arrives as a plain browser redirect with no
        # Authorization header — there is no other way to know whose grant it
        # is, and trusting a user id in the query string would let anyone
        # attach their Google account to somebody else's Curatix account.
        self._cache.set(
            self._state_key(state),
            {"user_id": str(user_id), "code_verifier": verifier},
            timeout_seconds=STATE_TTL_SECONDS,
        )

        url = self._calendar.build_authorization_url(
            state=state,
            code_challenge=challenge,
            redirect_uri=self._redirect_uri,
            login_hint=login_hint,
        )
        return AuthorizationRequest(authorization_url=url, state=state)

    # --- completing the flow ----------------------------------------------

    def complete_authorization(
        self, *, state: str, code: str = "", error: str = ""
    ) -> ConnectionResult:
        """Handle Google's redirect back.

        Unauthenticated by necessity — the browser returns from Google with no
        token of ours. `state` is the whole credential, which is why it is
        random, server-side, single-use and short-lived.
        """
        if not state:
            raise OAuthStateInvalidError("Missing state.")

        # CONSUMED, not merely read. Deleting before doing any work is what
        # makes a replayed callback fail: the second attempt finds nothing.
        # Doing it first also means a crash mid-exchange cannot leave a
        # redeemable state behind.
        pending = self._cache.get(self._state_key(state))
        self._cache.delete(self._state_key(state))
        if not pending:
            raise OAuthStateInvalidError(
                "That authorization link has expired or was already used. Try connecting again."
            )

        if error:
            # `access_denied` is the user pressing Cancel. A legitimate
            # choice, reported as such rather than as a failure.
            if error == "access_denied":
                raise OAuthConsentDeniedError("You cancelled the Google connection.")
            raise OAuthStateInvalidError(f"Google returned an error: {error}")

        if not code:
            raise OAuthStateInvalidError("Google returned no authorization code.")

        user_id = uuid.UUID(str(pending["user_id"]))
        existing = self._connections.get_for_user(user_id)

        try:
            tokens = self._calendar.exchange_code(
                code=code,
                code_verifier=str(pending["code_verifier"]),
                redirect_uri=self._redirect_uri,
            )
        except CalendarAuthError as exc:
            raise OAuthStateInvalidError(
                "Google would not complete the connection. Try again."
            ) from exc
        except CalendarError as exc:
            raise CalendarSyncFailedError("Could not reach Google. Try again.") from exc

        # Consent given but the calendar box unticked. Caught HERE rather than
        # on the first write, so the user is told while they still remember
        # what they clicked.
        if CALENDAR_EVENTS_SCOPE not in tokens.scopes:
            raise InsufficientScopeError(
                "Calendar access was not granted. Reconnect and leave the calendar "
                "permission ticked."
            )

        connection = self._connections.upsert(
            user_id=user_id,
            access_token=tokens.access_token,
            refresh_token=tokens.refresh_token,
            expires_at=tokens.expires_at,
            scopes=tokens.scopes,
            account_email=tokens.account_email,
        )
        record_audit(
            actor_id=str(user_id),
            action="integrations.google_connected",
            target_type="google_connection",
            target_id=str(connection.id),
            metadata={"account_email": tokens.account_email, "reconnect": bool(existing)},
        )
        logger.info("integrations.google_connected", extra={"user_id": str(user_id)})
        return ConnectionResult(connection=connection, reconnected=bool(existing))

    # --- ending it --------------------------------------------------------

    def disconnect(self, *, user_id: uuid.UUID) -> bool:
        """Revoke at Google, then delete locally.

        Order matters and this order is deliberate: revoke first so the token
        is dead even if the local delete fails, and `revoke` never raises so
        an unreachable Google cannot leave a user unable to disconnect. The
        calendar entries already created are LEFT in the user's calendar —
        they are the user's data, and deleting somebody's diary because they
        unlinked an account would be the platform overreaching.
        """
        connection = self._connections.get_for_user(user_id)
        if connection is None:
            return False

        refresh_token = self._connections.refresh_token(connection)
        access_token = self._connections.access_token(connection)
        # Revoking the refresh token kills the whole grant including access
        # tokens; the access token is a fallback for a connection whose
        # refresh token could not be decrypted.
        self._calendar.revoke(refresh_token or access_token or "")

        self._connections.delete_for_user(user_id)
        record_audit(
            actor_id=str(user_id),
            action="integrations.google_disconnected",
            target_type="google_connection",
            target_id=str(connection.id),
        )
        return True

    # --- the token the rest of the system needs ---------------------------

    def access_token_for(self, connection: GoogleConnection) -> str:
        """A usable access token, refreshing under a lock if needed.

        Raises `CalendarReconnectRequiredError` when the grant is dead. The
        caller must not retry that — it is terminal until the user acts.
        """
        if connection.status != ConnectionStatus.ACTIVE:
            raise CalendarReconnectRequiredError(
                connection.status_detail or "Reconnect your Google account."
            )

        if connection.access_token_is_fresh:
            token = self._connections.access_token(connection)
            if token:
                return token
            # Undecryptable: SECRET_KEY rotated. Fall through to refresh,
            # which will fail the same way and mark the connection — a clean
            # "reconnect" prompt rather than a 500.

        return self._refresh(connection)

    def _refresh(self, connection: GoogleConnection) -> str:
        """Mint a new access token under the connection's row lock.

        ── WHY THE FAILURE IS RECORDED *OUTSIDE* THE TRANSACTION ────────

        Marking the connection dead and then raising from inside the same
        `atomic()` block rolls the mark back with everything else. The
        connection would stay ACTIVE, the next request would refresh again,
        fail again, and loop — which is precisely the "a dead grant is
        terminal" property this method exists to provide.

        So the block ends cleanly, carrying the outcome out in a local, and
        the mark plus the raise happen after it has committed.
        """
        from django.db import transaction

        dead_grant: Exception | None = None
        dead_detail = ""
        transient: Exception | None = None
        token = ""

        with transaction.atomic():
            # Re-read under the lock. A concurrent request may already have
            # refreshed while we waited, in which case there is nothing to do
            # — and doing it anyway could invalidate the token they just got,
            # because Google rotates the refresh token on some responses.
            locked = self._connections.lock_for_update(connection.user_id)
            if locked is None:
                raise CalendarNotConnectedError("No Google connection for this account.")
            if locked.status != ConnectionStatus.ACTIVE:
                raise CalendarReconnectRequiredError(
                    locked.status_detail or "Reconnect your Google account."
                )
            if locked.access_token_is_fresh:
                fresh = self._connections.access_token(locked)
                if fresh:
                    return fresh

            refresh_token = self._connections.refresh_token(locked)
            if not refresh_token:
                # Undecryptable (SECRET_KEY rotated) or never stored.
                dead_detail = "Stored credentials could not be read. Please reconnect."
                dead_grant = CalendarReconnectRequiredError(dead_detail)
            else:
                try:
                    tokens = self._calendar.refresh_access_token(refresh_token)
                except CalendarAuthError as exc:
                    # Revoked in the user's Google account, expired after six
                    # months idle, or the password changed. All terminal.
                    dead_detail = (
                        "Google access was revoked or expired. Reconnect to resume syncing."
                    )
                    dead_grant = exc
                except CalendarError as exc:
                    # Transient. The connection is fine; Google is not.
                    transient = exc
                else:
                    self._connections.store_refreshed_access_token(
                        locked,
                        access_token=tokens.access_token,
                        expires_at=tokens.expires_at,
                        refresh_token=tokens.refresh_token,
                    )
                    token = tokens.access_token

        if dead_grant is not None:
            self._connections.mark_needs_reconnect(connection, detail=dead_detail)
            logger.info("integrations.grant_dead", extra={"user_id": str(connection.user_id)})
            raise CalendarReconnectRequiredError(dead_detail) from dead_grant
        if transient is not None:
            raise CalendarSyncFailedError("Could not reach Google.") from transient
        return token


class CalendarSyncService:
    """Puts booked events into connected calendars, and keeps them true."""

    def __init__(
        self,
        *,
        oauth: GoogleOAuthService,
        connections: GoogleConnectionRepository,
        links: CalendarEventLinkRepository,
        calendar: CalendarPort,
        bookings: BookingRepository,
        events: EventRepository,
        task_queue: TaskQueuePort,
        site_url: str,
    ) -> None:
        self._oauth = oauth
        self._connections = connections
        self._links = links
        self._calendar = calendar
        self._bookings = bookings
        self._events = events
        self._task_queue = task_queue
        self._site_url = site_url.rstrip("/")

    # --- building the entry ----------------------------------------------

    def _draft(self, event, booking) -> CalendarEventDraft:
        """What goes in the calendar.

        `ends_at` is nullable on an Event, and a calendar entry MUST have an
        end. A two-hour default is used and SAID SO in the description —
        silently writing two hours would put a number in somebody's diary the
        organizer never stated, and they would plan their evening around it.
        This mirrors the frontend's `lib/event/calendar.ts` exactly, so the
        .ics download and the synced entry never disagree.
        """
        starts_at = event.starts_at
        ends_at = event.ends_at or (starts_at + timedelta(hours=2))
        assumed_end = event.ends_at is None

        url = f"{self._site_url}/events/{event.id}" if self._site_url else ""
        lines = [
            (event.description or "").strip(),
            f"Booking reference: {booking.reference}" if getattr(booking, "reference", "") else "",
            "End time not specified by the organizer — this entry assumes two hours."
            if assumed_end
            else "",
            url,
        ]
        return CalendarEventDraft(
            summary=event.title,
            description="\n\n".join(line for line in lines if line),
            location=", ".join(part for part in (event.venue, event.city) if part),
            starts_at=starts_at,
            ends_at=ends_at,
            url=url,
            reminder_minutes=list(DEFAULT_REMINDERS),
            idempotency_key=self._idempotency_key(booking.id),
        )

    @staticmethod
    def _idempotency_key(booking_id) -> str:
        """A Google event id derived from the booking.

        Google's ids must be lowercase base32hex (a–v, 0–9), 5–1024 chars. A
        UUID's hex is a subset of that once the dashes go, so this is stable,
        collision-free and dedupes a retried create INSIDE Google — the
        second attempt updates the same entry rather than adding a twin.
        """
        return f"evt{str(booking_id).replace('-', '')}"

    # --- the operations ---------------------------------------------------

    def connection_for(self, user_id: uuid.UUID) -> GoogleConnection:
        connection = self._connections.get_for_user(user_id)
        if connection is None:
            raise CalendarNotConnectedError("No Google Calendar connected for this account.")
        if not connection.has_scope(CALENDAR_EVENTS_SCOPE):
            raise InsufficientScopeError(
                "Calendar access was not granted. Reconnect and leave the calendar "
                "permission ticked."
            )
        return connection

    def add_booking(self, *, user_id: uuid.UUID, booking_id: uuid.UUID) -> str:
        """Put one booked event in the user's calendar. Idempotent.

        Returns the Google event id. Raises `CalendarNotConnectedError` if
        there is no connection — the API layer turns that into a 404 carrying
        the connect URL, so the frontend can offer to connect rather than
        pretending the entry was created.
        """
        connection = self.connection_for(user_id)
        booking = self._bookings.get_by_id(booking_id)
        if booking is None or str(booking.user_id) != str(user_id):
            # Same response for "not yours" as for "does not exist" — a
            # distinct 403 would confirm the booking exists to anyone probing.
            raise CalendarNotConnectedError("No such booking.")

        event = self._events.get_active_by_id(booking.event_id)
        if event is None:
            raise CalendarNotConnectedError("That event is no longer available.")

        access_token = self._oauth.access_token_for(connection)
        draft = self._draft(event, booking)
        existing = self._links.get_for_booking(connection_id=connection.id, booking_id=booking_id)

        try:
            if existing:
                ref = self._calendar.update_event(
                    access_token=access_token,
                    calendar_id=existing.calendar_id,
                    event_id=existing.google_event_id,
                    draft=draft,
                )
            else:
                ref = self._calendar.create_event(
                    access_token=access_token,
                    calendar_id=connection.calendar_id,
                    draft=draft,
                )
        except CalendarAuthError as exc:
            self._connections.mark_needs_reconnect(
                connection, detail="Google access was revoked. Reconnect to resume syncing."
            )
            raise CalendarReconnectRequiredError(
                "Google access was revoked. Reconnect to resume syncing."
            ) from exc
        except CalendarError as exc:
            raise CalendarSyncFailedError(
                str(exc) or "Google Calendar rejected the request."
            ) from exc

        self._links.record(
            connection=connection,
            booking_id=booking_id,
            event_id=event.id,
            google_event_id=ref.event_id,
            calendar_id=ref.calendar_id,
            html_link=ref.html_link,
        )
        self._connections.touch_synced(connection)
        return ref.event_id

    def remove_booking(self, *, user_id: uuid.UUID, booking_id: uuid.UUID) -> bool:
        """Take one entry out of the user's calendar."""
        connection = self.connection_for(user_id)
        link = self._links.get_for_booking(connection_id=connection.id, booking_id=booking_id)
        if link is None:
            return False

        access_token = self._oauth.access_token_for(connection)
        try:
            self._calendar.delete_event(
                access_token=access_token,
                calendar_id=link.calendar_id,
                event_id=link.google_event_id,
            )
        except CalendarAuthError as exc:
            self._connections.mark_needs_reconnect(
                connection, detail="Google access was revoked. Reconnect to resume syncing."
            )
            raise CalendarReconnectRequiredError("Google access was revoked.") from exc
        except CalendarError as exc:
            raise CalendarSyncFailedError("Could not remove the calendar entry.") from exc

        self._links.mark_deleted(link)
        return True

    def sync_event_changes(self, *, event_id: uuid.UUID) -> int:
        """The event moved. Update every calendar entry we created for it.

        Returns how many were updated. One attendee's dead grant must not
        stop the others, so each is attempted independently — the alternative
        is that the first revoked connection in the list silently strands
        everyone after it with a wrong time in their diary.
        """
        event = self._events.get_active_by_id(event_id)
        if event is None:
            return 0

        updated = 0
        for link in self._links.list_live_for_event(event_id):
            booking = self._bookings.get_by_id(link.booking_id)
            if booking is None:
                continue
            try:
                access_token = self._oauth.access_token_for(link.connection)
                ref = self._calendar.update_event(
                    access_token=access_token,
                    calendar_id=link.calendar_id,
                    event_id=link.google_event_id,
                    draft=self._draft(event, booking),
                )
                self._links.record(
                    connection=link.connection,
                    booking_id=link.booking_id,
                    event_id=event_id,
                    google_event_id=ref.event_id,
                    calendar_id=ref.calendar_id,
                    html_link=ref.html_link,
                )
                updated += 1
            except CalendarReconnectRequiredError:
                continue  # already marked; that user reconnects when they choose
            except CalendarError:
                logger.warning(
                    "integrations.calendar_update_failed",
                    extra={"link_id": str(link.id), "event_id": str(event_id)},
                )
                continue
        logger.info(
            "integrations.event_synced", extra={"event_id": str(event_id), "updated": updated}
        )
        return updated

    def cancel_event_everywhere(self, *, event_id: uuid.UUID) -> int:
        """The event was cancelled. Remove it from every calendar we wrote to.

        This is the operation that most justifies `CalendarEventLink`
        existing: without it a cancelled event stays in every attendee's
        diary, and people turn up.
        """
        removed = 0
        for link in self._links.list_live_for_event(event_id):
            try:
                access_token = self._oauth.access_token_for(link.connection)
                self._calendar.delete_event(
                    access_token=access_token,
                    calendar_id=link.calendar_id,
                    event_id=link.google_event_id,
                )
                self._links.mark_deleted(link)
                removed += 1
            except CalendarReconnectRequiredError:
                continue
            except CalendarError:
                logger.warning(
                    "integrations.calendar_delete_failed", extra={"link_id": str(link.id)}
                )
                continue
        logger.info(
            "integrations.event_cancelled_in_calendars",
            extra={"event_id": str(event_id), "removed": removed},
        )
        return removed

    # --- enqueueing, for the event handlers -------------------------------

    def enqueue_booking_sync(self, *, user_id: uuid.UUID, booking_id: uuid.UUID) -> None:
        """Off the request path. A booking confirmation must never wait on
        Google, and must never fail because Google did."""
        self._task_queue.enqueue(
            SYNC_BOOKING_TASK, {"user_id": str(user_id), "booking_id": str(booking_id)}
        )

    def enqueue_event_sync(self, *, event_id: uuid.UUID) -> None:
        self._task_queue.enqueue(SYNC_EVENT_TASK, {"event_id": str(event_id)})

    def enqueue_event_cancellation(self, *, event_id: uuid.UUID) -> None:
        self._task_queue.enqueue(CANCEL_EVENT_TASK, {"event_id": str(event_id)})
