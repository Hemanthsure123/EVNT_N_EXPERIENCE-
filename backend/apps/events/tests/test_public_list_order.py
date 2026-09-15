"""The public list's ORDER — which the landing page's two sections now share.

"Featured events" and "All events" both read `GET /events` and the featured
rail is the first five of it, so this order IS what a visitor sees at the top
of the front page. Two properties, and both used to be wrong:

1. **Among events that start together, the most recently published leads.**
   The tie was broken by `id`, a UUID — i.e. at random.
2. **A tie pages DETERMINISTICALLY.** DRF's cursor paginator re-applies its own
   `ordering`, which was `"starts_at"` alone, so the repository's `id`
   tie-break was discarded and tied rows came back in whatever order Postgres
   chose that time. Cursor pagination resolves ties by OFFSET, and an offset
   over an unstable order can skip an event or show it twice.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.events.models import Event
from apps.events.pagination import EventCursorPagination
from apps.events.repositories import PUBLIC_LIST_ORDERING


def _titles(response) -> list[str]:
    return [row["title"] for row in response.json()["data"]]


@pytest.mark.django_db
def test_soonest_first_then_newest_published_among_a_tie(api_client, make_event):
    start = timezone.now() + timedelta(days=5)
    older = make_event(title="Published last week", starts_at=start)
    newer = make_event(title="Published an hour ago", starts_at=start)
    make_event(title="Starts a day earlier", starts_at=start - timedelta(days=1))

    Event.objects.filter(pk=older.pk).update(moderated_at=timezone.now() - timedelta(days=7))
    Event.objects.filter(pk=newer.pk).update(moderated_at=timezone.now() - timedelta(hours=1))

    assert _titles(api_client.get("/api/v1/events")) == [
        "Starts a day earlier",
        "Published an hour ago",
        "Published last week",
    ]


@pytest.mark.django_db
def test_a_tie_pages_without_skipping_or_repeating(api_client, make_event):
    # Five events at the SAME instant with no publish stamp — the case where
    # only the final `id` tie-break separates them. Walked two at a time, every
    # one must appear exactly once.
    start = timezone.now() + timedelta(days=3)
    expected = {str(make_event(title=f"Tied {n}", starts_at=start).pk) for n in range(5)}

    seen: list[str] = []
    url: str | None = "/api/v1/events?page_size=2"
    while url:
        body = api_client.get(url).json()
        seen.extend(row["id"] for row in body["data"])
        url = body["meta"]["next"]

    assert len(seen) == len(set(seen)), "an event was repeated across a page boundary"
    assert set(seen) == expected, "an event was skipped across a page boundary"


def test_the_paginator_and_the_repository_order_by_the_same_tuple():
    # The regression this file exists for: DRF REPLACES the queryset's order
    # with the paginator's, so two copies of the ordering are one silent
    # disagreement away from the bug above.
    assert EventCursorPagination.ordering == PUBLIC_LIST_ORDERING
    assert PUBLIC_LIST_ORDERING[0] == "starts_at", "the cursor position column"
