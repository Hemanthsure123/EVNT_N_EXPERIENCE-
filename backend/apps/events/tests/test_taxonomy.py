"""The taxonomy, and the frontend mirror of it.

``frontend/lib/events/taxonomy.ts`` restates every slug in
``apps/events/taxonomy.py``. It has to — the wizard's picker and the browse
page's filter chips are both rendered before any request resolves, and
``lib/discovery/categories.ts`` already has the same arrangement with
``EventCategory``.

Duplication that nothing checks is duplication that drifts, and the drift here
is SILENT in the worst direction: a tag added on the backend and forgotten in
the mirror simply never appears in the picker, and a tag renamed on the
frontend produces a chip that matches no event for ever. Neither raises.

So this file READS THE TYPESCRIPT and compares. It is a plain text parse rather
than a node invocation on purpose: pytest must not depend on a JS toolchain
being installed, and the file is generated from this module's own data, so its
shape is known.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from apps.events.taxonomy import (
    ALL_TAGS,
    EVENT_TYPE_MAX_LENGTH,
    MAX_TAGS,
    MIN_TAGS_TO_PUBLISH,
    TAG_DIMENSIONS,
    EventType,
    dimensions_covered,
    unknown_tags,
)

MIRROR = Path(__file__).resolve().parents[4] / "frontend" / "lib" / "events" / "taxonomy.ts"


def _mirror_source() -> str:
    if not MIRROR.exists():  # pragma: no cover - the file is committed
        pytest.skip(f"frontend mirror not found at {MIRROR}")
    return MIRROR.read_text(encoding="utf-8")


def _slugs_between(source: str, start: str, end: str) -> list[str]:
    """Every `value: '...'` between two markers, in order."""
    section = source.split(start, 1)[1].split(end, 1)[0]
    return re.findall(r"value: '([^']+)'", section)


class TestTheVocabularyItself:
    def test_every_event_type_slug_is_url_safe(self):
        """These become `?event_type=` values and index keys.

        A space or an uppercase letter survives a Python test suite perfectly
        well and then breaks a shared link, which is the sort of defect that is
        found by a customer rather than by CI.
        """
        for value, _label in EventType.choices:
            assert re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", value), value

    def test_every_tag_slug_is_url_safe(self):
        for slug in ALL_TAGS:
            assert re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug), slug

    def test_no_event_type_slug_would_overflow_the_column(self):
        """`max_length` is enforced only by production Postgres.

        A slug longer than the column raises `DataError` at write time and
        nowhere else — not in SQLite, not in a serializer, not in review.
        """
        longest = max(value for value, _ in EventType.choices)
        assert len(longest) <= EVENT_TYPE_MAX_LENGTH

    def test_tag_slugs_are_unique_across_dimensions(self):
        """A slug in two dimensions makes `dimensionOf` ambiguous and the
        reverse index silently keep only the last one."""
        seen: list[str] = []
        for dimension in TAG_DIMENSIONS:
            seen.extend(dimension.tags)
        assert len(seen) == len(set(seen))

    def test_there_are_enough_tags_to_satisfy_the_publish_gate(self):
        """The gate must be reachable.

        If the vocabulary ever shrank below `MIN_TAGS_TO_PUBLISH`, no event
        could be published at all — and the failure would present as "publish
        is broken", not as "the taxonomy is too small".
        """
        assert len(ALL_TAGS) >= MIN_TAGS_TO_PUBLISH
        assert MIN_TAGS_TO_PUBLISH <= MAX_TAGS

    def test_unknown_tags_names_all_of_them_at_once(self):
        assert unknown_tags(["outdoor", "nope", "also-nope"]) == ["nope", "also-nope"]
        assert unknown_tags(["outdoor"]) == []

    def test_dimensions_covered_ignores_values_it_does_not_know(self):
        covered = dimensions_covered(["outdoor", "networking", "not-a-tag"])
        assert covered == {"setting", "social"}


class TestTheFrontendMirror:
    """Read the TypeScript and compare it, slug for slug."""

    def test_every_event_type_is_mirrored_in_the_same_order(self):
        mirrored = _slugs_between(
            _mirror_source(), "export const EVENT_TYPES", "export const TAG_DIMENSIONS"
        )
        assert mirrored == [value for value, _ in EventType.choices]

    def test_every_tag_dimension_and_tag_is_mirrored_in_the_same_order(self):
        source = _mirror_source()
        section = source.split("export const TAG_DIMENSIONS", 1)[1].split(
            "export const MAX_TAGS", 1
        )[0]

        assert re.findall(r"key: '([^']+)'", section) == [d.key for d in TAG_DIMENSIONS]
        expected = [slug for dimension in TAG_DIMENSIONS for slug in dimension.tags]
        assert re.findall(r"value: '([^']+)'", section) == expected

    def test_the_two_limits_agree(self):
        """A frontend cap higher than the server's is a picker that lets
        somebody choose an eleventh tag and then refuses the save."""
        source = _mirror_source()

        def declared(name: str) -> str:
            # A missing constant is a FAILURE, not a crash on `None.group` —
            # the message should name what is absent from the mirror.
            found = re.search(rf"export const {name} = (\d+);", source)
            assert found, f"{name} is not declared in the frontend mirror"
            return found.group(1)

        assert declared("MAX_TAGS") == str(MAX_TAGS)
        assert declared("MIN_TAGS_TO_PUBLISH") == str(MIN_TAGS_TO_PUBLISH)

    def test_the_mirror_imports_nothing(self):
        """It is imported by the wizard's pure draft model.

        `categories.ts` pulls in eight lucide icons at module scope; this file
        following it would drag an icon library into the draft model and its
        vitest suite. Any artwork mapping belongs in the picker component.
        """
        assert not re.search(r"^\s*import\s", _mirror_source(), re.M)
