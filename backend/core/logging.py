"""Structured logging: JSON in every real environment, human-readable in
DEBUG, both carrying a per-request correlation id (see middleware.py) so log
lines from one request can be grepped together across the whole call stack.
"""

from __future__ import annotations

import contextvars
import logging
import uuid

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


def new_request_id() -> str:
    return uuid.uuid4().hex[:16]


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


def build_logging_config(*, debug: bool) -> dict:
    if debug:
        formatter = {"format": "%(asctime)s %(levelname)s %(name)s [%(request_id)s] %(message)s"}
    else:
        formatter = {
            "()": "pythonjsonlogger.jsonlogger.JsonFormatter",
            "format": "%(asctime)s %(levelname)s %(name)s %(request_id)s %(message)s",
        }

    return {
        "version": 1,
        "disable_existing_loggers": False,
        "filters": {"request_id": {"()": "core.logging.RequestIdFilter"}},
        "formatters": {"default": formatter},
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "formatter": "default",
                "filters": ["request_id"],
            }
        },
        "root": {"handlers": ["console"], "level": "INFO"},
        "loggers": {
            "django": {"handlers": ["console"], "level": "INFO", "propagate": False},
            "django.request": {"handlers": ["console"], "level": "WARNING", "propagate": False},
        },
    }
