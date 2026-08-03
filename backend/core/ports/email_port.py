"""Port for transactional email delivery.

`send` returns a provider reference (the provider's message id) so a caller
that logs deliveries — `notifications`, the first real consumer — can store it
for tracing/support. The console adapter returns a synthetic id; real adapters
return the provider's own id.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class EmailAttachment:
    """One file to send alongside the message.

    ── BYTES, NOT A PATH OR A URL ────────────────────────────────────────────

    A path assumes the sender and the adapter share a filesystem, which stops
    being true the moment sending moves to a worker or a vendor API. A URL
    turns an attachment into a second thing that has to stay reachable, stay
    authorised, and outlive the email — which is most of what an attachment
    exists to avoid. So the caller hands over finished bytes and the adapter's
    only job is to carry them.

    ── NO SIZE LIMIT HERE, DELIBERATELY ──────────────────────────────────────

    Providers differ (Gmail 25MB, SES 40MB, plenty of corporate relays far
    less), and a port that guessed one would either refuse what a provider
    would have taken or accept what it would bounce. The one attachment this
    platform sends is a ticket PDF of a few kilobytes; if that ever changes,
    the check belongs beside whatever generates the file, where the real size
    is known.
    """

    filename: str
    content: bytes
    content_type: str = "application/octet-stream"


class EmailPort(ABC):
    @abstractmethod
    def send(
        self,
        *,
        to: str,
        subject: str,
        body: str,
        html: str = "",
        attachments: tuple[EmailAttachment, ...] = (),
    ) -> str:
        """Send an email. Returns a provider message reference for tracing.

        `body` is the plain-text part and is REQUIRED. `html` is an optional
        richer alternative sent alongside it — never instead of it. A
        multipart message is what text-only clients, screen readers and spam
        filters all expect, and an adapter that ignores `html` still delivers
        a complete message rather than an empty one.

        `attachments` follows the same rule: the message must still make sense
        WITHOUT them. Somebody reading on a client that hides attachments, or
        forwarding only the text, has to be able to act on it — so the ticket
        PDF is a convenience on top of an email that already carries the
        booking reference, the QR tokens and a link to the tickets, never the
        only copy. The `()` default keeps every existing caller valid.
        """
