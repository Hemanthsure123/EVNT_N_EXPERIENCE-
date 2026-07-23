"""Real EmailPort adapter for a generic transactional-email HTTP API.

Kept vendor-neutral on purpose: the exact provider (Postmark, SendGrid,
SES, ...) is an infrastructure decision, not a business one. Swapping
providers means changing this one file, not the callers of EmailPort."""

from __future__ import annotations

import requests

from core.ports.email_port import EmailPort


class HttpEmailAdapter(EmailPort):
    def __init__(self, *, api_key: str, from_address: str, api_base_url: str) -> None:
        self._api_key = api_key
        self._from_address = from_address
        self._api_base_url = api_base_url.rstrip("/")

    def send(self, *, to: str, subject: str, body: str) -> None:
        response = requests.post(
            f"{self._api_base_url}/send",
            headers={"Authorization": f"Bearer {self._api_key}"},
            json={"from": self._from_address, "to": to, "subject": subject, "text": body},
            timeout=10,
        )
        response.raise_for_status()
