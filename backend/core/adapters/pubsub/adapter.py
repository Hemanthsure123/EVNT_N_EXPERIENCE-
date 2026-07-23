"""Real EventBusPort adapter backed by Google Cloud Pub/Sub.

Requires the optional `gcp` extra. Only imported by config/di.py when
EVENT_BUS_BACKEND=pubsub. Subscriptions in production are managed as
infrastructure (Terraform/console), not runtime code, so `subscribe` keeps
the EventBusPort base no-op rather than pretending to support it here."""

from __future__ import annotations

import json

from google.cloud import pubsub_v1

from core.ports.event_bus_port import EventBusPort


class PubSubEventBusAdapter(EventBusPort):
    def __init__(self, *, project_id: str, topic_name: str) -> None:
        self._publisher = pubsub_v1.PublisherClient()
        self._topic_path = self._publisher.topic_path(project_id, topic_name)

    def publish(self, event_type: str, payload: dict) -> None:
        data = json.dumps({"event_type": event_type, "payload": payload}).encode("utf-8")
        self._publisher.publish(self._topic_path, data, event_type=event_type)
