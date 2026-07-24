"""Signed ticket QR tokens.

A token carries ONLY ids (ticket + event) — never any personal data — and is
HMAC-signed with a server secret, so it can't be forged or tampered with: any
change to the payload invalidates the signature. `checkin` (later) will call
`verify_ticket_token` at the gate with the same secret.

Format: ``v1.<payload_b64url>.<sig_b64url>`` where payload is compact JSON.
The `v1` prefix leaves room to rotate the scheme/secret later.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import uuid
from dataclasses import dataclass

_VERSION = "v1"


@dataclass(frozen=True)
class TicketTokenPayload:
    ticket_id: str
    event_id: str


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def _sign(payload_b64: str, secret: str) -> str:
    digest = hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).digest()
    return _b64url_encode(digest)


def sign_ticket(*, ticket_id: uuid.UUID | str, event_id: uuid.UUID | str, secret: str) -> str:
    payload_b64 = _b64url_encode(
        json.dumps({"tid": str(ticket_id), "eid": str(event_id)}, separators=(",", ":")).encode()
    )
    return f"{_VERSION}.{payload_b64}.{_sign(payload_b64, secret)}"


def verify_ticket_token(token: str, *, secret: str) -> TicketTokenPayload | None:
    """Return the token's ids if the signature is valid, else None. Never
    raises on malformed/tampered input — a bad token is simply invalid."""
    try:
        version, payload_b64, signature = token.split(".")
    except (ValueError, AttributeError):
        return None
    if version != _VERSION:
        return None

    expected = _sign(payload_b64, secret)
    # Constant-time compare so a timing side-channel can't reveal the signature.
    if not hmac.compare_digest(expected, signature):
        return None

    try:
        data = json.loads(_b64url_decode(payload_b64))
        return TicketTokenPayload(ticket_id=data["tid"], event_id=data["eid"])
    except (ValueError, KeyError, TypeError):
        return None
