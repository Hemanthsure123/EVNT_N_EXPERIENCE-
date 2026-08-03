"""The SMTP email adapter.

Email is how a customer receives their ticket. The failure that matters most
is not "the relay was down" — that retries — but "we recorded a send that
never happened", so these concentrate on the boundary between the adapter and
`NotificationService`: what it returns, and what it does with an exception.
"""

from __future__ import annotations

from typing import cast

import pytest
from django.core import mail
from django.core.mail import EmailMultiAlternatives

from core.adapters.smtp.adapter import SmtpEmailAdapter


def build(**overrides) -> SmtpEmailAdapter:
    kwargs = {
        "host": "smtp.example.com",
        "port": 587,
        "username": "postmaster@example.com",
        "password": "secret",
        "from_email": "tickets@curatix.example",
        "use_tls": True,
        "use_ssl": False,
        **overrides,
    }
    return SmtpEmailAdapter(**kwargs)


class TestConfigurationIsValidatedAtConstruction:
    """At construction, not at first send — because the first send is the
    first ticket somebody buys."""

    def test_tls_and_ssl_together_are_refused(self):
        # 587 is STARTTLS, 465 is implicit TLS. They are different protocols,
        # not a strength setting, and Django raises for the combination lazily.
        with pytest.raises(ValueError) as caught:
            build(use_tls=True, use_ssl=True)
        assert "mutually exclusive" in str(caught.value)

    def test_either_one_alone_is_accepted(self):
        assert build(use_tls=True, use_ssl=False)
        assert build(use_tls=False, use_ssl=True, port=465)

    def test_a_missing_host_is_refused(self):
        with pytest.raises(ValueError) as caught:
            build(host="")
        assert "SMTP_HOST" in str(caught.value)

    def test_a_missing_from_address_is_refused(self):
        # Some relays accept an empty envelope sender and deliver mail that
        # fails SPF everywhere — which looks like "email works" until it does
        # not, and by then the ticket emails are in spam folders.
        with pytest.raises(ValueError) as caught:
            build(from_email="")
        assert "SMTP_FROM_EMAIL" in str(caught.value)


class TestSending:
    @pytest.fixture(autouse=True)
    def _empty_outbox(self):
        mail.outbox = []
        yield
        mail.outbox = []

    def _adapter(self, monkeypatch, **overrides):
        """Swap the BACKEND on the adapter's own connection kwargs.

        Setting `EMAIL_BACKEND` would not redirect it: the adapter builds its
        connection from explicit kwargs precisely so its transport is not
        implicit global state. So the substitution happens where it is named.
        """
        adapter = build(**overrides)
        adapter._connection_kwargs["backend"] = "django.core.mail.backends.locmem.EmailBackend"
        return adapter

    def test_it_sends_one_message_to_one_recipient(self, monkeypatch):
        adapter = self._adapter(monkeypatch)
        adapter.send(to="fan@example.com", subject="Your ticket", body="Here it is.")

        assert len(mail.outbox) == 1
        sent = mail.outbox[0]
        assert sent.to == ["fan@example.com"]
        assert sent.subject == "Your ticket"
        assert sent.body == "Here it is."
        assert sent.from_email == "tickets@curatix.example"

    def test_html_is_attached_as_an_ALTERNATIVE_not_a_replacement(self, monkeypatch):
        """`content_subtype = "html"` — the other common way to send HTML mail
        — REPLACES the text part, leaving text-only clients with raw markup
        and costing deliverability. This must stay multipart/alternative."""
        adapter = self._adapter(monkeypatch)
        adapter.send(
            to="fan@example.com",
            subject="Your code",
            body="Your code is 123456.",
            html="<html><body>123456</body></html>",
        )

        # `mail.outbox` is typed as EmailMessage; the adapter sends the
        # subclass, and `alternatives` is exactly the difference under test.
        sent = cast(EmailMultiAlternatives, mail.outbox[0])
        assert sent.body == "Your code is 123456."  # text part intact
        assert sent.alternatives == [("<html><body>123456</body></html>", "text/html")]

    def test_no_html_sends_a_plain_message_rather_than_an_empty_part(self, monkeypatch):
        """Most types have no HTML. An empty alternative would be a
        zero-length text/html part, which some clients render as a blank
        message body in preference to the text one."""
        adapter = self._adapter(monkeypatch)
        adapter.send(to="fan@example.com", subject="s", body="b")

        assert cast(EmailMultiAlternatives, mail.outbox[0]).alternatives == []

    def test_the_returned_reference_is_the_message_id_actually_sent(self, monkeypatch):
        """The whole point of the return value.

        SMTP assigns no provider id — RFC 5322 makes Message-ID the sender's
        job. Minting it here means the same string appears in
        `NotificationLog.provider_ref`, in the outbound headers and in the
        recipient's copy, so "I never got my ticket" is traceable end to end.
        """
        adapter = self._adapter(monkeypatch)
        returned = adapter.send(to="fan@example.com", subject="s", body="b")

        assert returned.startswith("<") and returned.endswith(">")
        assert mail.outbox[0].extra_headers["Message-ID"] == returned

    def test_the_message_id_is_scoped_to_the_sending_domain(self, monkeypatch):
        adapter = self._adapter(monkeypatch)
        returned = adapter.send(to="fan@example.com", subject="s", body="b")
        assert returned.endswith("@curatix.example>")

    def test_two_sends_get_distinct_references(self, monkeypatch):
        adapter = self._adapter(monkeypatch)
        first = adapter.send(to="a@example.com", subject="s", body="b")
        second = adapter.send(to="b@example.com", subject="s", body="b")
        # A shared id would collapse two deliveries into one in any trace.
        assert first != second

    def test_a_relay_failure_propagates_rather_than_being_swallowed(self, monkeypatch):
        """`fail_silently=False` is load-bearing.

        `NotificationService.dispatch` treats an exception as a retryable
        failure and counts the attempt. Swallowing it would mark the
        notification SENT while nothing left the building — the exact class of
        silent failure this codebase exists to avoid.
        """
        adapter = self._adapter(monkeypatch)

        def explode(self, email_messages):
            raise ConnectionRefusedError("relay refused the connection")

        monkeypatch.setattr("django.core.mail.backends.locmem.EmailBackend.send_messages", explode)

        with pytest.raises(ConnectionRefusedError):
            adapter.send(to="fan@example.com", subject="s", body="b")


class TestWiring:
    def test_di_builds_the_smtp_adapter_when_selected(self, settings):
        from config.di import email_port

        settings.EMAIL_PROVIDER = "smtp"
        settings.SMTP_HOST = "smtp.example.com"
        settings.SMTP_PORT = 587
        settings.SMTP_USERNAME = "u"
        settings.SMTP_PASSWORD = "p"
        settings.SMTP_FROM_EMAIL = "tickets@curatix.example"
        settings.SMTP_USE_TLS = True
        settings.SMTP_USE_SSL = False
        settings.SMTP_TIMEOUT_SECONDS = 10

        email_port.cache_clear()
        try:
            assert isinstance(email_port(), SmtpEmailAdapter)
        finally:
            email_port.cache_clear()

    def test_the_retired_http_provider_is_gone(self):
        # The vendor-neutral HTTP adapter was removed when SMTP became the real
        # transport. Leaving it would mean EMAIL_API_KEY / EMAIL_API_BASE_URL
        # staying in the environment as live-looking config for an adapter
        # nothing selects.
        with pytest.raises(ModuleNotFoundError):
            import core.adapters.email_provider.adapter  # noqa: F401

    def test_an_unknown_provider_is_refused_loudly(self, settings):
        from config.di import email_port

        settings.EMAIL_PROVIDER = "carrier-pigeon"
        email_port.cache_clear()
        try:
            with pytest.raises(ValueError, match="Unknown EMAIL_PROVIDER"):
                email_port()
        finally:
            email_port.cache_clear()


def test_preflight_requires_smtp_credentials_when_smtp_is_selected():
    """Selecting the adapter without a host is a 500 on the first ticket
    bought, not at boot — unless preflight catches it."""
    from core.preflight import InsecureConfigurationError, check_production_settings
    from core.tests.test_preflight import _Settings

    with pytest.raises(InsecureConfigurationError) as caught:
        check_production_settings(_Settings(EMAIL_PROVIDER="smtp", SMTP_HOST=""), strict=True)
    assert "SMTP_HOST" in str(caught.value)
