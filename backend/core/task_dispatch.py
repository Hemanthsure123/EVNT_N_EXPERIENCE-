"""The endpoint Cloud Tasks delivers to.

`CloudTasksQueueAdapter.enqueue` has always POSTed each task to
`CLOUD_TASKS_TARGET_URL`. Nothing was listening. With
`QUEUE_BACKEND=cloud_tasks`, every enqueue therefore succeeded — the queue
accepted the task — and every delivery 404'd, silently, forever. The
symptom would have been: bookings never expire, payouts never release,
notifications never send, and no error anywhere in the application, because
from the app's point of view the work was handed off successfully.

This is the receiving half.

── AUTHENTICATION, AND WHY IT IS NOT THE PLATFORM'S JWT ──────────────────

This endpoint runs registered task handlers by name. `settlements.
release_payout` moves money. An unauthenticated version is a URL anyone on
the internet can use to trigger a payout, so the credential is the whole
design:

- A shared secret (`INTERNAL_TASK_SECRET`) in `X-Internal-Task-Secret`,
  compared in CONSTANT TIME. Not the platform's JWT, because the caller is
  a queue and not a user — issuing a service account a user token would put
  a permanent, highly-privileged credential into the token store.
- Compared with `hmac.compare_digest`, not `==`. A plain comparison returns
  faster on an early mismatch, which over enough requests reveals the
  secret one byte at a time.
- Cloud Run should ALSO be configured to require an OIDC token from the
  queue's service account, so the secret is defence in depth rather than
  the only wall. The audit document says how.

── DELIVERY SEMANTICS ────────────────────────────────────────────────────

Cloud Tasks is at-least-once and retries on any non-2xx. So:

- **Unknown task name → 200, not 404.** A task queued by a previous
  release whose handler no longer exists can never succeed; returning an
  error would make the queue retry it until its deadline, every time, for
  as long as the queue is configured to. It is logged as an error instead.
- **Handler raised → 500,** which is exactly what should be retried, with
  the queue's own backoff rather than a hand-rolled one.
- **Malformed body → 400 with no retry value,** logged.
- Handlers must be idempotent, which every registered task already is
  (`release_expired` re-checks under a row lock, `release_payout` no-ops on
  a settlement already paid, `dispatch` re-checks `status == pending`).
"""

from __future__ import annotations

import hmac
import json
import logging

from django.conf import settings
from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from core.tasks import run_task

logger = logging.getLogger(__name__)

SECRET_HEADER = "HTTP_X_INTERNAL_TASK_SECRET"


@csrf_exempt
@require_POST
def run_queued_task(request: HttpRequest) -> JsonResponse:
    """POST {"task_name": "...", "payload": {...}} — queue only.

    A plain Django view, like `health_check`, for the same reasons: it must
    not go through DRF authentication (the caller is not a user), must not
    be throttled by a user-keyed limiter, and must not have its response
    reshaped into the API's error envelope, which is a contract with our own
    frontend and not with Google's queue.
    """
    expected = settings.INTERNAL_TASK_SECRET
    if not expected:
        # Selecting the cloud queue without setting the secret is caught by
        # preflight at boot. This is the second line: never accept an
        # unauthenticated task run because a variable was missing.
        logger.error("task_dispatch.no_secret_configured")
        return JsonResponse({"error": "task dispatch is not configured"}, status=503)

    supplied = request.META.get(SECRET_HEADER, "")
    if not hmac.compare_digest(supplied, expected):
        logger.warning("task_dispatch.forbidden")
        return JsonResponse({"error": "forbidden"}, status=403)

    try:
        body = json.loads(request.body or b"{}")
        task_name = body["task_name"]
        payload = body.get("payload") or {}
    except (ValueError, KeyError, TypeError):
        logger.error("task_dispatch.malformed_body")
        return JsonResponse({"error": "malformed task body"}, status=400)

    if not isinstance(payload, dict):
        return JsonResponse({"error": "payload must be an object"}, status=400)

    try:
        run_task(task_name, payload)
    except KeyError:
        # Retrying can never help — see the module docstring.
        logger.error("task_dispatch.unknown_task", extra={"task_name": task_name})
        return JsonResponse({"status": "unknown_task", "task_name": task_name}, status=200)
    except Exception:
        logger.exception("task_dispatch.failed", extra={"task_name": task_name})
        return JsonResponse({"status": "error", "task_name": task_name}, status=500)

    logger.info("task_dispatch.ran", extra={"task_name": task_name})
    return JsonResponse({"status": "ok", "task_name": task_name}, status=200)
