"""Encryption for secrets held at rest on behalf of a user.

Exactly one thing needs this today: Google OAuth refresh tokens. A refresh
token is a long-lived, self-renewing key to somebody's calendar — it does
not expire on its own, and anyone holding one can mint access tokens until
the user notices and revokes it. A database dump containing them in
plaintext is a breach of every connected account, not just of our own data.

Everything else in this codebase is either a hash (passwords), a signature
(JWTs, QR tokens) or a vendor reference (`rzp_pay_...`). None of those is
reversible, which is why this module did not exist until now.

── THE KEY IS DERIVED FROM `SECRET_KEY`, NOT A NEW VARIABLE ─────────────

HKDF-SHA256 over `SECRET_KEY` with a fixed, purpose-scoped `info` string.
That is a deliberate trade:

  + No new secret to distribute, rotate or lose. One fewer thing between a
    working deployment and a broken one.
  + The `info` string domain-separates this from any future use of the same
    root key, so a second consumer cannot derive the same bytes.
  − Rotating `SECRET_KEY` makes stored tokens undecryptable.

That last point is the reason this is acceptable HERE and would not be for,
say, stored payment data: an unreadable refresh token is recoverable. The
connection is marked as needing reconnection and the user clicks "Connect"
again. Nothing is lost but a click. `decrypt` returns `None` rather than
raising precisely so a key rotation degrades to "everyone reconnects"
instead of "every calendar sync 500s".

If that trade ever stops being acceptable — because something irreplaceable
gets encrypted — introduce a dedicated `TOKEN_ENCRYPTION_KEY`, keep this
derivation as the fallback, and re-encrypt on read.
"""

from __future__ import annotations

import base64
import logging

from django.conf import settings

logger = logging.getLogger(__name__)

# Domain separation. Changing this string is equivalent to rotating the key.
_HKDF_INFO = b"curatix.oauth-token-encryption.v1"


def _fernet():
    """Build the cipher. Imported lazily so a deployment that never touches
    an OAuth token does not need `cryptography` installed."""
    try:
        from cryptography.fernet import Fernet
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    except ImportError as exc:  # pragma: no cover - exercised by the extras
        raise RuntimeError(
            "Storing an OAuth refresh token requires `cryptography`:\n"
            '    pip install -e ".[push]"'
        ) from exc

    secret = settings.SECRET_KEY.encode()
    derived = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        # No salt: the input is a high-entropy secret rather than a password,
        # and a random salt would have to be stored beside the ciphertext for
        # no gain. The `info` string does the separation work.
        salt=None,
        info=_HKDF_INFO,
    ).derive(secret)
    return Fernet(base64.urlsafe_b64encode(derived))


def encrypt(value: str) -> str:
    """Encrypt a secret for storage. Empty in, empty out.

    Fernet is AES-128-CBC with an HMAC-SHA256 tag and a timestamp — so the
    stored value is authenticated, not merely scrambled. A tampered row fails
    to decrypt rather than yielding attacker-chosen plaintext.
    """
    if not value:
        return ""
    return _fernet().encrypt(value.encode()).decode()


def decrypt(value: str) -> str | None:
    """Decrypt, or `None` if it cannot be read.

    `None` rather than an exception, and the distinction is the whole point:
    an unreadable token means the key rotated or the row was tampered with,
    and in both cases the correct behaviour is "treat this connection as
    disconnected and ask the user to reconnect" — not a 500 on the booking
    confirmation that happened to trigger a calendar sync.
    """
    if not value:
        return None
    try:
        return _fernet().decrypt(value.encode()).decode()
    except Exception:
        # Logged without the value. At WARNING because a burst of these means
        # SECRET_KEY was rotated and every connected user is about to be asked
        # to reconnect — worth noticing, not worth paging.
        logger.warning("encryption.decrypt_failed")
        return None
