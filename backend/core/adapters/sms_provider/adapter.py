"""Real SmsPort adapter for a generic transactional-SMS HTTP API
(India DLT entity/template ids are passed through for compliance)."""

from __future__ import annotations

import requests

from core.ports.sms_port import SmsPort


class HttpSmsAdapter(SmsPort):
    def __init__(
        self,
        *,
        api_key: str,
        sender_id: str,
        dlt_entity_id: str,
        dlt_template_id: str,
        api_base_url: str,
    ) -> None:
        self._api_key = api_key
        self._sender_id = sender_id
        self._dlt_entity_id = dlt_entity_id
        self._dlt_template_id = dlt_template_id
        self._api_base_url = api_base_url.rstrip("/")

    def send(self, *, to: str, message: str) -> None:
        response = requests.post(
            f"{self._api_base_url}/send",
            headers={"Authorization": f"Bearer {self._api_key}"},
            json={
                "to": to,
                "message": message,
                "sender_id": self._sender_id,
                "dlt_entity_id": self._dlt_entity_id,
                "dlt_template_id": self._dlt_template_id,
            },
            timeout=10,
        )
        response.raise_for_status()
