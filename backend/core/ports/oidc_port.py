"""Signing IN with an external identity provider.

DELIBERATELY SEPARATE FROM `CalendarPort`, even though both are Google OAuth
against the same client. They answer different questions and carry different
risk:

    CalendarPort   "this signed-in user has GRANTED us access to their
                   calendar" — an additive permission on an account that
                   already exists, and the tokens are the valuable thing.

    OidcPort       "this browser IS this person" — the whole basis of who we
                   think somebody is. Nothing is stored; the ANSWER is what
                   matters, and getting it wrong means logging one person into
                   another's account.

Folding sign-in into the calendar port would mean one class where a mistake in
the identity path could be masked by the calendar path's tests. It also keeps
the scopes honest: this port asks for identity ONLY, never `calendar.events`,
so a sign-in consent screen does not demand access to somebody's calendar in
order to log in.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


class OidcError(RuntimeError):
    """The provider could not be reached, or answered something unusable."""


class OidcIdentityError(OidcError):
    """The provider answered, but the identity it returned cannot be trusted.

    Separate from `OidcError` because the two mean different things to the
    caller: a transport failure is worth retrying, and an identity that fails
    validation is an attack or a misconfiguration and must never be retried
    into a session.
    """


@dataclass(frozen=True)
class OidcIdentity:
    """Who the provider says this is."""

    #: The provider's STABLE identifier for the account (`sub`). Not the
    #: email: a person can change their Google address, and Google explicitly
    #: documents `sub` as the only claim safe to key on long-term.
    subject: str
    email: str
    #: Whether the PROVIDER has proven the address. Critical for linking: an
    #: unverified Google address must never be allowed to take over an
    #: existing Curatix account with the same email, because anyone can put
    #: any address on an unverified account.
    email_verified: bool
    full_name: str = ""


class OidcPort(ABC):
    @abstractmethod
    def is_configured(self) -> bool:
        """False when no credentials are set, so the UI can hide the button
        rather than offer a control that cannot work."""

    @abstractmethod
    def build_authorization_url(
        self, *, state: str, code_challenge: str, redirect_uri: str, login_hint: str = ""
    ) -> str: ...

    @abstractmethod
    def exchange_code(self, *, code: str, code_verifier: str, redirect_uri: str) -> OidcIdentity:
        """Swap the authorization code for a VERIFIED identity.

        Returns the identity rather than raw tokens on purpose. Sign-in has no
        use for an access token — it never calls a Google API on the user's
        behalf — so handing one back would be an invitation to store a
        credential nobody needs.
        """
