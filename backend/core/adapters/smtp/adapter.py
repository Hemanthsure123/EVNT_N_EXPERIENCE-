"""Real EmailPort adapter backed by SMTP.

Replaces the generic HTTP email-provider adapter. SMTP is the transport the
platform actually uses, so the vendor-neutral HTTP adapter (and its
`EMAIL_API_KEY` / `EMAIL_API_BASE_URL` settings) were removed rather than
left behind as an unselectable second implementation with live config.

── THE PROVIDER REFERENCE IS A MESSAGE-ID WE MINT ────────────────────────

`EmailPort.send` promises a reference `notifications` can store for tracing.
An HTTP API hands one back; SMTP does not — RFC 5322 makes `Message-ID` the
SENDER's responsibility, and a relay that assigns its own does so in a
header we never see.

So this generates one and sets it explicitly. That is not a workaround; it
is how SMTP is specified to work, and it is strictly better for support: the
same id appears in `NotificationLog.provider_ref`, in the outbound headers,
and in the recipient's copy — so "I never got my ticket" can be traced
end to end from one string. Leaving it unset would make the relay invent one
we could never correlate.

── TLS AND SSL ARE MUTUALLY EXCLUSIVE, AND THAT IS THE COMMON MISTAKE ────

Port 587 means STARTTLS (`SMTP_USE_TLS`), port 465 means implicit TLS
(`SMTP_USE_SSL`). They are different protocols, not a strength setting.
Django raises `ValueError` if both are on, and it does so lazily on the
first send — which is the first ticket somebody buys. This validates at
construction so the failure lands at boot, next to the preflight check.

── THE CONNECTION IS PER-SEND, ON PURPOSE ───────────────────────────────

Every send happens inside a background task (`notifications.dispatch`), one
message at a time, with retry and dead-lettering around it. A pooled
long-lived SMTP connection would be an idle socket per worker that relays
drop after a timeout, producing a first-send failure per idle period. Opening
one connection per message costs a TLS handshake on a path that is already
asynchronous and already retried.
"""

from __future__ import annotations

import logging
from email.utils import make_msgid, parseaddr
from typing import Any

from django.core.mail import EmailMultiAlternatives, get_connection

from core.ports.email_port import EmailAttachment, EmailPort

logger = logging.getLogger(__name__)


class SmtpEmailAdapter(EmailPort):
    def __init__(
        self,
        *,
        host: str,
        port: int,
        username: str,
        password: str,
        from_email: str,
        use_tls: bool = True,
        use_ssl: bool = False,
        timeout_seconds: int = 10,
    ) -> None:
        if use_tls and use_ssl:
            raise ValueError(
                "SMTP_USE_TLS and SMTP_USE_SSL are mutually exclusive: 587 uses "
                "STARTTLS (SMTP_USE_TLS=true), 465 uses implicit TLS "
                "(SMTP_USE_SSL=true). Set exactly one."
            )
        if not host:
            raise ValueError("SMTP_HOST is required with EMAIL_PROVIDER=smtp.")
        if not from_email:
            # A relay will usually reject an empty envelope sender outright,
            # but some accept it and deliver mail that fails SPF at every
            # recipient — which looks like "email works" until it doesn't.
            raise ValueError("SMTP_FROM_EMAIL is required with EMAIL_PROVIDER=smtp.")

        self._from_email = from_email
        # `SMTP_FROM_EMAIL` may carry a DISPLAY NAME — `Curatix <a@b.com>` — which
        # is what makes an inbox show the product rather than a bare address.
        # `rpartition("@")` on that returns `b.com>`, trailing bracket included,
        # and `make_msgid` would then stamp every message with a syntactically
        # invalid `Message-ID`. That is not cosmetic: a malformed Message-ID is a
        # spam-filter signal and breaks threading, and it fails in the direction
        # nobody checks — the mail still sends.
        #
        # `parseaddr` understands both spellings and is in the standard library
        # for exactly this. It returns ("", addr) for a bare address.
        self._domain = parseaddr(from_email)[1].rpartition("@")[2] or None
        # `dict[str, Any]`, not the inferred `dict[str, object]`: `get_connection`
        # is typed with a distinct annotation per keyword, so splatting an
        # `object`-valued mapping into it cannot type-check. The values are
        # heterogeneous by design — this is Django's own signature.
        self._connection_kwargs: dict[str, Any] = {
            "backend": "django.core.mail.backends.smtp.EmailBackend",
            "host": host,
            "port": port,
            "username": username,
            "password": password,
            "use_tls": use_tls,
            "use_ssl": use_ssl,
            # Without a timeout a wedged relay hangs the worker forever and the
            # notification never reaches its retry, so it is neither sent nor
            # dead-lettered — it just stops.
            "timeout": timeout_seconds,
        }

    def send(
        self,
        *,
        to: str,
        subject: str,
        body: str,
        html: str = "",
        attachments: tuple[EmailAttachment, ...] = (),
    ) -> str:
        # Domain-scoped so the id is globally unique and attributable to us.
        message_id = make_msgid(domain=self._domain)

        # `EmailMultiAlternatives` rather than `EmailMessage`: `body` stays the
        # text/plain part and the HTML is attached as an ALTERNATIVE, producing
        # a `multipart/alternative` message. Setting `content_subtype = "html"`
        # instead — the other common way to send HTML mail — replaces the text
        # part rather than adding to it, leaving text-only clients with markup
        # and costing deliverability.
        message = EmailMultiAlternatives(
            subject=subject,
            body=body,
            from_email=self._from_email,
            to=[to],
            connection=get_connection(**self._connection_kwargs),
        )
        if html:
            message.attach_alternative(html, "text/html")
        for attachment in attachments:
            # Explicit MIME type rather than letting Django sniff from the
            # filename: a ticket PDF arriving as application/octet-stream is
            # one Gmail offers to download instead of previewing, which is a
            # worse experience for the one attachment this platform sends.
            message.attach(attachment.filename, attachment.content, attachment.content_type)

        # Set BEFORE sending: Django's SMTP backend generates its own
        # Message-ID only when the header is absent, so assigning it here is
        # what makes the returned reference match what was actually sent.
        message.extra_headers["Message-ID"] = message_id

        # `fail_silently=False` is the default and is load-bearing: the caller
        # (`NotificationService.dispatch`) treats an exception as a retryable
        # failure and counts the attempt. Swallowing it would mark the
        # notification SENT while nothing left the building.
        message.send(fail_silently=False)

        logger.info("smtp_email.sent", extra={"message_id": message_id})
        return message_id
