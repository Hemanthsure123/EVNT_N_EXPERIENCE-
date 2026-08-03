"""ORM access for the Google connection and its calendar links.

The only place these queries live. Token decryption happens here too, at the
boundary: services deal in plaintext tokens and never in ciphertext, so no
caller can forget to decrypt (or, worse, log the encrypted blob believing it
is safe because it looks like noise).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from django.db import transaction
from django.utils import timezone

from core.base_repository import BaseRepository
from core.encryption import decrypt, encrypt

from .models import CalendarEventLink, ConnectionStatus, GoogleConnection


class GoogleConnectionRepository(BaseRepository[GoogleConnection]):
    model = GoogleConnection

    def get_for_user(self, user_id: uuid.UUID) -> GoogleConnection | None:
        return self.get_queryset().filter(user_id=user_id).first()

    def lock_for_update(self, user_id: uuid.UUID) -> GoogleConnection | None:
        """`SELECT ... FOR UPDATE` on the connection row.

        Serialises token refresh. Two concurrent calendar writes for the same
        user would otherwise both see an expired token, both call Google, and
        the second refresh would invalidate the first — Google rotates the
        refresh token on some responses, so the loser's stored token becomes
        dead. The lock makes exactly one of them refresh.
        """
        return self.get_queryset().select_for_update().filter(user_id=user_id).first()

    @transaction.atomic
    def upsert(
        self,
        *,
        user_id: uuid.UUID,
        access_token: str,
        refresh_token: str,
        expires_at: datetime,
        scopes: list[str],
        account_email: str,
        calendar_id: str = "primary",
    ) -> GoogleConnection:
        """Create or replace a user's grant. Idempotent by construction.

        `update_or_create` on the user is what makes "handle duplicate
        connections" and "support reconnect" the same code path: connecting
        twice replaces the tokens rather than creating a second grant.

        The refresh token is preserved when Google sends a blank one. That is
        not a defensive nicety — Google issues a refresh token only on a fresh
        consent, and returns nothing in that field on every subsequent
        exchange. Blindly writing the response would erase the only credential
        capable of renewing the connection, and it would fail an hour later.
        """
        existing = self.get_queryset().filter(user_id=user_id).first()
        encrypted_refresh = (
            encrypt(refresh_token)
            if refresh_token
            else (existing.refresh_token_encrypted if existing else "")
        )

        connection, _ = GoogleConnection.objects.update_or_create(
            user_id=user_id,
            defaults={
                "access_token_encrypted": encrypt(access_token),
                "refresh_token_encrypted": encrypted_refresh,
                "access_token_expires_at": expires_at,
                "granted_scopes": scopes,
                "account_email": account_email or (existing.account_email if existing else ""),
                "calendar_id": calendar_id,
                "status": ConnectionStatus.ACTIVE,
                "status_detail": "",
            },
        )
        return connection

    def store_refreshed_access_token(
        self,
        connection: GoogleConnection,
        *,
        access_token: str,
        expires_at: datetime,
        refresh_token: str = "",
    ) -> GoogleConnection:
        """Write a renewed access token. Same refresh-token rule as `upsert`."""
        connection.access_token_encrypted = encrypt(access_token)
        connection.access_token_expires_at = expires_at
        if refresh_token:
            # Google rotates it occasionally; when it does, the old one dies.
            connection.refresh_token_encrypted = encrypt(refresh_token)
        connection.status = ConnectionStatus.ACTIVE
        connection.status_detail = ""
        connection.save(
            update_fields=[
                "access_token_encrypted",
                "access_token_expires_at",
                "refresh_token_encrypted",
                "status",
                "status_detail",
                "updated_at",
            ]
        )
        return connection

    def mark_needs_reconnect(self, connection: GoogleConnection, *, detail: str) -> None:
        """The grant is dead. Clear the tokens, keep the row.

        Tokens are cleared because they are now useless AND still sensitive —
        keeping a dead refresh token is all of the liability and none of the
        value. The row survives so the UI can say "reconnect" and name the
        account, which is a far better prompt than reverting to "connect" as
        though the user never did.
        """
        connection.status = ConnectionStatus.NEEDS_RECONNECT
        connection.status_detail = detail[:255]
        connection.access_token_encrypted = ""
        connection.refresh_token_encrypted = ""
        connection.access_token_expires_at = None
        connection.save(
            update_fields=[
                "status",
                "status_detail",
                "access_token_encrypted",
                "refresh_token_encrypted",
                "access_token_expires_at",
                "updated_at",
            ]
        )

    def touch_synced(self, connection: GoogleConnection) -> None:
        connection.last_synced_at = timezone.now()
        connection.save(update_fields=["last_synced_at", "updated_at"])

    def delete_for_user(self, user_id: uuid.UUID) -> bool:
        deleted, _ = GoogleConnection.objects.filter(user_id=user_id).delete()
        return bool(deleted)

    # --- token access, decrypted at the boundary --------------------------

    @staticmethod
    def access_token(connection: GoogleConnection) -> str | None:
        return decrypt(connection.access_token_encrypted)

    @staticmethod
    def refresh_token(connection: GoogleConnection) -> str | None:
        return decrypt(connection.refresh_token_encrypted)


class CalendarEventLinkRepository(BaseRepository[CalendarEventLink]):
    model = CalendarEventLink

    def get_for_booking(
        self, *, connection_id: uuid.UUID, booking_id: uuid.UUID
    ) -> CalendarEventLink | None:
        return (
            self.get_queryset()
            .filter(connection_id=connection_id, booking_id=booking_id, deleted_at__isnull=True)
            .first()
        )

    def record(
        self,
        *,
        connection: GoogleConnection,
        booking_id: uuid.UUID,
        event_id: uuid.UUID,
        google_event_id: str,
        calendar_id: str,
        html_link: str,
    ) -> CalendarEventLink:
        """Idempotent on (connection, booking) — the unique constraint's pair.

        `update_or_create` rather than `create`: a retried sync must update
        the existing link, not collide. The constraint is what guarantees it
        under concurrency; this is the happy path.
        """
        link, _ = CalendarEventLink.objects.update_or_create(
            connection=connection,
            booking_id=booking_id,
            defaults={
                "event_id": event_id,
                "google_event_id": google_event_id,
                "calendar_id": calendar_id,
                "html_link": html_link,
                "deleted_at": None,
            },
        )
        return link

    def list_live_for_event(self, event_id: uuid.UUID, *, limit: int = 500) -> list:
        """Every calendar entry this platform still owns for one event.

        Used by the event-changed and event-cancelled fan-outs.
        `select_related` on the connection because each link's sync needs that
        user's tokens — without it this is an N+1 across every attendee, which
        for a sold-out event is hundreds of queries.
        """
        return list(
            self.get_queryset()
            .select_related("connection")
            .filter(event_id=event_id, deleted_at__isnull=True)
            .order_by("created_at")[:limit]
        )

    def mark_deleted(self, link: CalendarEventLink) -> None:
        link.deleted_at = timezone.now()
        link.save(update_fields=["deleted_at", "updated_at"])
