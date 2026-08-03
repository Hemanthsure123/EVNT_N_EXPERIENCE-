"""Gunicorn access-log filtering.

One job: keep the health endpoint out of the access log. The container
healthcheck polls `/health/` every 30 seconds and an orchestrator polls it
more often than that, so left alone it is the single most frequent line in
the log and it buries real traffic.

A logger subclass is gunicorn's only supported hook for this. A `pre_request`
hook cannot do it — by the time gunicorn writes the access line, the hook has
long since returned and there is no per-request flag it consults.

**Why this lives in `core/` and not next to `gunicorn.conf.py`.** gunicorn
resolves `logger_class` by importing the dotted path, and the config file sits
in `backend/docker/`. `docker.gunicorn_logging` would be a namespace package
named `docker` — the same name as a widely installed PyPI package. If anything
ever pulls that in, which of the two wins depends on `sys.path` order, and the
symptom would be an unrelated import error at worker start. `core` is this
application's own package and cannot be shadowed.
"""

from __future__ import annotations

from typing import Any

from gunicorn.glogging import Logger

# Probe endpoints, not application routes. Anything a human or an integration
# calls must stay in the log.
_SILENT_PATHS = frozenset({"/health/", "/health"})


class QuietHealthLogger(Logger):
    def access(self, resp: Any, req: Any, environ: dict[str, Any], request_time: Any) -> None:
        # A FAILING probe is still logged: a 503 from /health/ means the
        # database or cache is down, which is exactly the line somebody will
        # be looking for. Only the successful noise is dropped.
        if environ.get("PATH_INFO") in _SILENT_PATHS and str(
            getattr(resp, "status", "")
        ).startswith("2"):
            return
        super().access(resp, req, environ, request_time)
