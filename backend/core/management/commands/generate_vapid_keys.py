"""Generate a VAPID key pair for Web Push.

    python manage.py generate_vapid_keys

This is the entire credential story for push. There is no vendor account to
open, no key to be issued and nothing to pay for: VAPID (RFC 8292) is an
ECDSA P-256 key pair that the sender generates itself, and browsers accept
it because the public half travels with each subscription. That is why push
could be finished in this audit while Google sign-in and SMS could not.

Generate ONE pair per environment and put it in that environment's secrets
manager. Rotating invalidates nothing stored — the subscriptions stay valid
— but every push signed with the new key is rejected by services that
cached the old one for a subscription, so a rotation should be followed by
letting clients re-subscribe.
"""

from __future__ import annotations

import base64
from typing import Any

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Print a fresh VAPID public/private key pair for Web Push."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument(
            "--env",
            action="store_true",
            help="Print as .env lines ready to paste.",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        try:
            from cryptography.hazmat.primitives import serialization
            from cryptography.hazmat.primitives.asymmetric import ec
        except ImportError:
            raise SystemExit(
                "This command needs `cryptography`, which comes with the push extra:\n"
                '    pip install -e ".[push]"'
            ) from None

        private_key = ec.generate_private_key(ec.SECP256R1())

        # Both halves are base64url WITHOUT padding — the encoding the Web Push
        # ecosystem uses everywhere. `applicationServerKey` in the browser and
        # pywebpush's `vapid_private_key` both expect exactly this, and padded
        # standard base64 fails with an error that names neither.
        private_value = private_key.private_numbers().private_value
        private_bytes = private_value.to_bytes(32, "big")

        public_bytes = private_key.public_key().public_bytes(
            encoding=serialization.Encoding.X962,
            # UNCOMPRESSED (65 bytes, 0x04-prefixed) is what browsers require
            # for applicationServerKey. A compressed point is a valid P-256
            # key that Chrome refuses without explaining why.
            format=serialization.PublicFormat.UncompressedPoint,
        )

        public = _b64url(public_bytes)
        private = _b64url(private_bytes)

        if options["env"]:
            self.stdout.write(f"VAPID_PUBLIC_KEY={public}")
            self.stdout.write(f"VAPID_PRIVATE_KEY={private}")
            self.stdout.write("VAPID_CONTACT=mailto:ops@yourdomain.example")
            return

        self.stdout.write(self.style.SUCCESS("VAPID key pair (base64url, unpadded)"))
        self.stdout.write("")
        self.stdout.write(f"  public  : {public}")
        self.stdout.write(f"  private : {private}")
        self.stdout.write("")
        self.stdout.write(
            "Store the PRIVATE key in your secrets manager as VAPID_PRIVATE_KEY.\n"
            "The public key is not secret — every subscribing browser receives it.\n"
            "Set VAPID_CONTACT to a mailto: or https URL a push service can reach\n"
            "you at; the spec requires it and Firefox rejects tokens without one."
        )


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
