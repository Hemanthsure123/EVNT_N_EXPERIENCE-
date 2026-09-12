"""The poster is required to PUBLISH, and permissive everywhere else.

`Event.poster_url` is `blank=True` at the column, so a wizard that autosaves on
a keystroke can save a title before anybody has chosen artwork. The demand is
made once, at the boundary between a draft and a listing real people will see —
the same place the tag minimum and the gallery floor are made, and for the same
reason.

The placeholder the frontend draws is a BROKEN-IMAGE fallback, not a bypass:
without this gate an organizer could publish a listing whose poster, front-page
card, OG image, mobile hero and issued ticket are all a flat blue rectangle.
"""

from __future__ import annotations

import pytest

from apps.events import publish_checks
from apps.events.exceptions import EventNotPublishableError
from apps.events.models import EventStatus

from .conftest import *  # noqa: F401,F403 — reuse the module's fixtures


@pytest.mark.django_db
class TestThePosterGate:
    def test_an_event_with_no_poster_is_refused(self, make_event, add_ticket_type):
        event = make_event(status=EventStatus.DRAFT, poster_url="")
        add_ticket_type(event)

        with pytest.raises(EventNotPublishableError) as caught:
            publish_checks.run_publish_checks(event)

        # It names the thing and where to fix it. "Invalid event" sends nobody
        # anywhere; the frontend renders this message verbatim.
        assert "poster" in caught.value.message.lower()

    def test_whitespace_is_not_a_poster(self, make_event, add_ticket_type):
        # A CharField happily stores "   ". Every other required check on this
        # module strips before testing, and a blank-looking URL that passed
        # would publish exactly the listing this gate exists to refuse.
        event = make_event(status=EventStatus.DRAFT, poster_url="   ")
        add_ticket_type(event)

        with pytest.raises(EventNotPublishableError):
            publish_checks.run_publish_checks(event)

    def test_an_event_with_a_poster_publishes(self, make_event, add_ticket_type):
        event = make_event(status=EventStatus.DRAFT)
        add_ticket_type(event)
        publish_checks.run_publish_checks(event)  # does not raise

    def test_the_column_still_accepts_blank(self, make_event):
        """The DRAFT keeps working. The gate is at publish, not at save — a
        NOT NULL here would refuse the first keystroke of a new event."""
        event = make_event(status=EventStatus.DRAFT, poster_url="")
        assert event.poster_url == ""
