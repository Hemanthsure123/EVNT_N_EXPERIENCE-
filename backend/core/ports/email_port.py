"""Port for transactional email delivery."""

from __future__ import annotations

from abc import ABC, abstractmethod


class EmailPort(ABC):
    @abstractmethod
    def send(self, *, to: str, subject: str, body: str) -> None: ...
