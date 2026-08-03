"""Print exactly what must be registered in the Google Cloud console.

    python manage.py show_google_oauth_setup

── WHY THIS EXISTS ───────────────────────────────────────────────────────

`redirect_uri_mismatch` is Google's most common OAuth failure and its least
informative: the browser gets a generic "Access blocked: this app's request
is invalid" page, the request never reaches our callback, and NOTHING is
logged on our side — there is no request to log, because Google refuses
before redirecting. Every value involved is correct in isolation; the fault
is that a string here does not appear in a list over there.

So the fix is to print the strings. Google compares them BYTE FOR BYTE — a
trailing slash, `https` where the app sends `http`, or a stray space pasted
from a terminal are each enough to fail, and each looks identical to a
correct entry when read by eye in a console text field.

This command is read-only and contacts nothing. It cannot verify that a URI
IS registered — Google exposes no API for that on an OAuth client — so it
reports what we send and flags what is likely to be wrong about it.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from django.conf import settings
from django.core.management.base import BaseCommand

LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]"}


class Command(BaseCommand):
    help = "Print the Google OAuth client id and redirect URIs that must be registered."

    def handle(self, *args: Any, **options: Any) -> None:
        client_id = settings.GOOGLE_OAUTH_CLIENT_ID
        secret = settings.GOOGLE_OAUTH_CLIENT_SECRET

        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Google OAuth — console setup"))
        self.stdout.write("")

        if not client_id:
            self.stdout.write(
                self.style.ERROR(
                    "GOOGLE_OAUTH_CLIENT_ID is not set. Google sign-in and Calendar are both "
                    "off; the sign-in endpoints report unavailable rather than failing at "
                    "the consent screen."
                )
            )
            return

        self.stdout.write("APIs & Services -> Credentials -> the OAuth 2.0 Client ID below.")
        self.stdout.write("")
        self.stdout.write(f"  Client ID     {client_id}")
        self.stdout.write(
            f"  Client secret {'set' if secret else self.style.ERROR('MISSING')}"
            f"{'' if secret else '  <- token exchange will fail after consent'}"
        )
        self.stdout.write("")
        self.stdout.write("Authorised redirect URIs — BOTH must be listed, verbatim:")
        self.stdout.write("")

        entries = [
            ("Sign in with Google", settings.GOOGLE_OAUTH_SIGNIN_REDIRECT_URI),
            ("Connect Google Calendar", settings.GOOGLE_OAUTH_REDIRECT_URI),
        ]
        problems: list[str] = []

        for label, uri in entries:
            if not uri:
                self.stdout.write(f"  {self.style.WARNING('(unset)'):<62}  {label}")
                problems.append(f"{label}: its redirect URI is not configured, so it cannot run.")
                continue
            self.stdout.write(f"  {uri:<62}  {label}")
            problems.extend(self._inspect(label, uri))

        self.stdout.write("")
        if problems:
            self.stdout.write(self.style.WARNING("Likely problems:"))
            for problem in problems:
                self.stdout.write(f"  - {problem}")
        else:
            self.stdout.write(
                self.style.SUCCESS("Nothing suspect in these values. If sign-in still returns")
            )
            self.stdout.write(
                self.style.SUCCESS(
                    "Error 400: redirect_uri_mismatch, the URI above is simply not on the "
                    "client's list — copy it in exactly as printed."
                )
            )
        self.stdout.write("")

    def _inspect(self, label: str, uri: str) -> list[str]:
        """Everything that makes a byte-for-byte comparison fail silently."""
        found: list[str] = []
        parsed = urlparse(uri)

        if uri != uri.strip():
            found.append(f"{label}: has leading or trailing whitespace — Google will not match it.")
        if uri.endswith("/"):
            # The single most common paste error, and invisible in a text field.
            found.append(
                f"{label}: ends with a slash. Our routes have none, so a registered "
                f"'…/callback/' never matches the '…/callback' we send."
            )
        if parsed.scheme not in {"http", "https"}:
            found.append(f"{label}: scheme is {parsed.scheme!r}; Google accepts http or https.")
        elif parsed.scheme == "http" and parsed.hostname not in LOCAL_HOSTS:
            # Google permits plain http ONLY for loopback.
            found.append(
                f"{label}: uses http on a non-local host ({parsed.hostname}). Google "
                f"rejects that outside localhost — use https."
            )
        return found
