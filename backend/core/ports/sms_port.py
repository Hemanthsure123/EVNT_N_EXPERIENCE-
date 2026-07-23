"""Port for transactional SMS delivery (India DLT-registered sender in production)."""

from __future__ import annotations

from abc import ABC, abstractmethod


class SmsPort(ABC):
    @abstractmethod
    def send(self, *, to: str, message: str) -> None: ...
