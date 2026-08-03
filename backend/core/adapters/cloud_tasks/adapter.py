"""Real TaskQueuePort adapter backed by Google Cloud Tasks.

Requires the optional `gcp` extra. Only imported by config/di.py when
QUEUE_BACKEND=cloud_tasks. Each task is delivered as an HTTP POST to
`core.task_dispatch.run_queued_task`, mounted at `/internal/tasks/run`,
which dispatches by `task_name` through the same `core.tasks` registry the
synchronous adapter uses.

Two credentials travel with every task, and they do different jobs:

- `X-Internal-Task-Secret` is a shared secret proving the request came from
  us. It is the application-level check, and the one the endpoint enforces.
- `oidc_token` (when `service_account_email` is set) makes Cloud Tasks mint
  a Google-signed identity token for the queue's service account. Cloud Run
  can then verify it at the platform level and reject unauthenticated
  requests before they reach Django at all. Belt and braces on purpose: the
  handlers this endpoint runs include one that releases money.
"""

from __future__ import annotations

import json
import time

from google.cloud import tasks_v2

from core.ports.task_queue_port import TaskQueuePort


class CloudTasksQueueAdapter(TaskQueuePort):
    def __init__(
        self,
        *,
        project_id: str,
        location: str,
        queue: str,
        target_url: str,
        shared_secret: str = "",
        service_account_email: str = "",
    ) -> None:
        if not target_url:
            # Fail here rather than at the first enqueue. An adapter that
            # accepts tasks and posts them nowhere is the exact failure this
            # module was missing: the queue reports success and the work never
            # happens.
            raise ValueError(
                "CLOUD_TASKS_TARGET_URL is required with QUEUE_BACKEND=cloud_tasks — "
                "it is this service's own /internal/tasks/run URL."
            )
        self._client = tasks_v2.CloudTasksClient()
        self._queue_path = self._client.queue_path(project_id, location, queue)
        self._target_url = target_url
        self._shared_secret = shared_secret
        self._service_account_email = service_account_email

    def enqueue(self, task_name: str, payload: dict, *, delay_seconds: int = 0) -> str:
        headers = {"Content-Type": "application/json"}
        if self._shared_secret:
            headers["X-Internal-Task-Secret"] = self._shared_secret

        http_request: dict = {
            "http_method": tasks_v2.HttpMethod.POST,
            "url": self._target_url,
            "headers": headers,
            "body": json.dumps({"task_name": task_name, "payload": payload}).encode(),
        }
        if self._service_account_email:
            http_request["oidc_token"] = {
                "service_account_email": self._service_account_email,
                "audience": self._target_url,
            }

        task: dict = {"http_request": http_request}
        if delay_seconds:
            from google.protobuf import timestamp_pb2

            timestamp = timestamp_pb2.Timestamp()
            timestamp.FromSeconds(int(time.time()) + delay_seconds)
            task["schedule_time"] = timestamp

        response = self._client.create_task(parent=self._queue_path, task=task)
        return response.name
