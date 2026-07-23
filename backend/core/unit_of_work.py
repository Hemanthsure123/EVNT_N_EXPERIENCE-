"""Unit of Work: wraps a business operation's writes in one DB transaction
and gives it a single place to record outbox events.

Multi-step writes that must succeed or fail together (create a user +
record UserRegistered; mark an order paid + issue tickets + record
PaymentConfirmed) go inside a `with UnitOfWork() as uow:` block. On
successful exit, pending outbox events are drained immediately — this keeps
dev/test synchronous and simple. In every environment, config/worker.py
also polls the outbox independently, so a crash between commit and that
`on_commit` callback still gets the event published eventually.
"""

from __future__ import annotations

from types import TracebackType

from django.db import transaction

from core.outbox import record_event


class UnitOfWork:
    def __init__(self) -> None:
        self._atomic = transaction.atomic()

    def __enter__(self) -> UnitOfWork:
        self._atomic.__enter__()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        # Atomic.__exit__ never suppresses — it rolls back and lets the
        # exception propagate, which is exactly what we want here too.
        self._atomic.__exit__(exc_type, exc, tb)
        if exc_type is None:
            transaction.on_commit(_publish_pending_best_effort)

    def publish(self, event_type: str, payload: dict, *, aggregate_id: str = "") -> None:
        record_event(event_type=event_type, payload=payload, aggregate_id=aggregate_id)


def _publish_pending_best_effort() -> None:
    from core.outbox import publish_pending

    publish_pending()
