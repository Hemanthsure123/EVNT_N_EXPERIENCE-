"""Real TaskQueuePort adapter backed by Google Cloud Tasks.

Requires the optional `gcp` extra. Only imported by config/di.py when
QUEUE_BACKEND=cloud_tasks. Each task is delivered as an HTTP POST to an
internal endpoint that dispatches by `task_name` — that endpoint doesn't
exist yet (see task_queue_port.py); wire it up alongside the first real
consumer of this adapter."""

from __future__ import annotations

import json

from google.cloud import tasks_v2

from core.ports.task_queue_port import TaskQueuePort


class CloudTasksQueueAdapter(TaskQueuePort):
    def __init__(self, *, project_id: str, location: str, queue: str, target_url: str) -> None:
        self._client = tasks_v2.CloudTasksClient()
        self._queue_path = self._client.queue_path(project_id, location, queue)
        self._target_url = target_url

    def enqueue(self, task_name: str, payload: dict, *, delay_seconds: int = 0) -> str:
        task = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": self._target_url,
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps({"task_name": task_name, "payload": payload}).encode(),
            }
        }
        if delay_seconds:
            import time

            from google.protobuf import timestamp_pb2

            timestamp = timestamp_pb2.Timestamp()
            timestamp.FromSeconds(int(time.time()) + delay_seconds)
            task["schedule_time"] = timestamp

        response = self._client.create_task(parent=self._queue_path, task=task)
        return response.name
