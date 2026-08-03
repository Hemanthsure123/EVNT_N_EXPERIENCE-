"""Gunicorn configuration for the production web process.

Replaces `manage.py runserver`, which the compose file was using: single
threaded, auto-reloading, no request timeout, and documented by Django itself
as unsuitable for production.

Every value below is set from a consequence, not from a template.
"""

from __future__ import annotations

import multiprocessing
import os
import sys

bind = f"0.0.0.0:{os.environ.get('PORT', '8000')}"

# Sync workers, not gevent/eventlet. Every slow thing this app does is already
# off the request path (the outbox worker, the scheduler, the task queue), so
# the request handlers are short and CPU/DB bound — the regime sync workers
# are best at. Async workers would add a monkey-patching failure mode to
# psycopg2 and redis-py for no gain.
worker_class = "sync"

# ── WORKER COUNT IS BOUNDED BY THE POOLER, NOT BY THE CPU ────────────────
#
# `(2 x cores) + 1` is gunicorn's own guidance and it is the wrong ceiling
# here. Every worker holds its own Postgres connections, and the scheduler and
# outbox worker draw from the same Supabase pooler client limit — so an
# unbounded worker count on a large host exhausts the pooler, and the failure
# presents as a database outage rather than as too many workers.
#
# The cap therefore applies to the COMPUTED DEFAULT. An explicit
# WEB_CONCURRENCY is honoured, because silently discarding a value an operator
# set is the same failure mode as compose's `environment:` silently outranking
# `env_file:` — the thing this whole configuration exists to stop being
# possible. It is honoured LOUDLY: the risk is printed at the moment it is
# taken, on the process's first line of output.
POOLER_SAFE_WORKERS = 9

_requested = os.environ.get("WEB_CONCURRENCY", "").strip()
if _requested:
    workers = int(_requested)
    if workers > POOLER_SAFE_WORKERS:
        print(
            f"gunicorn: WEB_CONCURRENCY={workers} exceeds the pooler-safe ceiling of "
            f"{POOLER_SAFE_WORKERS}. Each worker holds its own database connections, and "
            f"the scheduler and outbox worker share the same pooler client limit. If the "
            f"limit is reached, requests fail as if the database were down. Honouring the "
            f"explicit value — raise the pooler's limit to match it.",
            file=sys.stderr,
        )
else:
    workers = min((multiprocessing.cpu_count() * 2) + 1, POOLER_SAFE_WORKERS)

# Two threads per worker. The checkout path waits on Razorpay and the calendar
# path waits on Google; a little concurrency stops one slow upstream call from
# blocking a whole worker, without the memory cost of doubling the count.
threads = int(os.environ.get("WEB_THREADS", 2))

# ── TIMEOUTS ─────────────────────────────────────────────────────────────
#
# `timeout` kills a worker whose request has hung. It MUST exceed the longest
# legitimate request: the slowest here is a Maps proxy call, whose own read
# timeout is 8s (core/adapters/google_maps/adapter.py), plus retries. 60s is
# comfortably above that and well below any sensible proxy timeout.
timeout = int(os.environ.get("WEB_TIMEOUT", 60))

# ── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────
#
# On SIGTERM gunicorn stops accepting, lets in-flight requests finish, then
# exits. `graceful_timeout` is how long that is allowed to take.
#
# This is not a nicety on this platform. A SIGTERM mid-request during a deploy
# can land between `payments` recording a webhook and `booking` issuing the
# ticket — the transaction would roll back and Razorpay would retry, which is
# safe, but only because the request was allowed to finish or fail cleanly
# rather than being killed halfway. 30s is longer than any request `timeout`
# permits, so a graceful stop always wins over a hard kill.
graceful_timeout = int(os.environ.get("WEB_GRACEFUL_TIMEOUT", 30))

# Slightly above a typical 60s upstream idle timeout, so the proxy closes idle
# connections rather than gunicorn racing it and producing spurious 502s.
keepalive = 65

# ── WORKER RECYCLING ─────────────────────────────────────────────────────
#
# Restart each worker after N requests, with jitter so they do not all recycle
# at once. This is insurance against slow leaks in long-lived C extensions
# (psycopg2, cryptography), not a fix for a known leak — it costs one process
# start per thousand requests and removes a whole class of overnight drift.
max_requests = 1000
max_requests_jitter = 100

# ── PRELOAD IS OFF, DELIBERATELY ─────────────────────────────────────────
#
# `preload_app` saves memory by importing before forking, but the imports here
# open sockets: `config/di.py` builds a Redis client and `settings/prod.py`
# runs preflight. Forking after that gives every worker a COPY of the parent's
# Redis connection, and concurrent use of one socket from several processes
# corrupts the protocol. Each worker importing for itself is worth the RAM.
preload_app = False

# stdout/stderr, picked up by the container runtime. The application's own
# structured JSON logging (core/logging.py) is unaffected — this is only
# gunicorn's access and error log.
accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("GUNICORN_LOG_LEVEL", "info")

# `%({x-request-id}i)s` ties gunicorn's access line to the id
# `core.middleware.RequestIDMiddleware` puts on every application log line, so
# one request can be followed across both streams.
access_log_format = '%(h)s "%(r)s" %(s)s %(b)s %(M)sms "%(f)s" "%(a)s" req=%({x-request-id}o)s'

# The health endpoint is polled every 30s by the container healthcheck and
# more often by an orchestrator. Logging it buries real traffic, so it is
# filtered out — via a logger subclass, which is gunicorn's only supported
# hook for this. (A `pre_request` hook cannot do it: by the time gunicorn
# writes the access line the hook has long returned.)
#
# In `core/`, not beside this file: gunicorn resolves this by importing the
# dotted path, and `docker.gunicorn_logging` would be a namespace package named
# `docker` — the same name as a widely installed PyPI package, so which one wins
# would depend on sys.path order.
logger_class = "core.gunicorn_logging.QuietHealthLogger"

# Which upstream addresses may set X-Forwarded-*. NOT "*" by default:
# gunicorn uses these headers to decide `wsgi.url_scheme`, and Django's
# `SECURE_PROXY_SSL_HEADER` trusts that in turn — so a blanket "*" on a
# publicly reachable port lets a client assert `X-Forwarded-Proto: https` and
# defeat SECURE_SSL_REDIRECT. In this topology the only thing in front is the
# Cloudflare Tunnel sidecar on the compose network, so the private ranges are
# the correct trust boundary. Override only if a proxy sits outside them.
forwarded_allow_ips = os.environ.get(
    "FORWARDED_ALLOW_IPS", "127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
)
