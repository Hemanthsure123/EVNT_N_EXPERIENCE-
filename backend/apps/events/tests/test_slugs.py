"""`event_slug` — pure, no database.

The properties asserted here are the ones the public URL depends on. A slug is
cosmetic (the uuid beside it carries identity), so none of these is about
correctness of resolution — they are about a URL that reads well, never ends in
a stray separator, and degrades to nothing rather than to mojibake.
"""

from apps.events.slugs import MAX_SLUG_LENGTH, event_slug


class TestBasicSlugs:
    def test_a_normal_title(self):
        assert event_slug("Sunburn Arena 2026") == "sunburn-arena-2026"

    def test_punctuation_and_ampersands_collapse(self):
        assert event_slug("Rock & Roll: The Night!") == "rock-roll-the-night"

    def test_repeated_whitespace_does_not_produce_repeated_hyphens(self):
        assert event_slug("Jazz    Night") == "jazz-night"

    def test_an_em_dash_title_reads_cleanly(self):
        assert event_slug("Comedy Night — Mumbai Edition") == "comedy-night-mumbai-edition"

    def test_it_is_idempotent(self):
        once = event_slug("Afterhours: Warehouse Rave")
        assert event_slug(once) == once


class TestDegradesRatherThanGuesses:
    def test_a_non_latin_title_slugs_to_nothing(self):
        # NOT an error. The event then serves `/events/{uuid}` — the URL this
        # platform served before slugs existed. `allow_unicode=True` would give
        # a percent-encoded path that renders as mojibake in the share sheets
        # this platform actually distributes through.
        assert event_slug("संगीत की रात") == ""
        assert event_slug("இசை இரவு") == ""

    def test_an_emoji_only_title_slugs_to_nothing(self):
        assert event_slug("🎸🎤") == ""

    def test_an_empty_title(self):
        assert event_slug("") == ""

    def test_a_title_of_only_punctuation(self):
        assert event_slug("!!! ??? ...") == ""


class TestLength:
    def test_a_long_title_is_cut_at_a_word_boundary(self):
        title = (
            "The Extraordinarily Long Name Of An Event "
            "That Simply Refuses To Stop Going On And On"
        )
        slug = event_slug(title)
        assert len(slug) <= MAX_SLUG_LENGTH
        # Cut between words, so the last token is whole rather than sliced.
        assert title.lower().replace(" ", "-").startswith(slug)

    def test_it_never_ends_in_a_hyphen(self):
        # A trailing "-" would produce "...--{uuid}" in the path, which reads as
        # a typo — and makes the emitted segment differ from the one the parser
        # round-trips to, which is how a page redirects to itself forever.
        for title in [
            "A" * 200,
            " ".join(["word"] * 60),
            "x" * (MAX_SLUG_LENGTH - 1) + " tail",
            "Event " + "y" * 200,
        ]:
            assert not event_slug(title).endswith("-"), title[:30]

    def test_a_single_word_longer_than_the_limit_is_still_bounded(self):
        slug = event_slug("Z" * 300)
        assert len(slug) <= MAX_SLUG_LENGTH
        assert not slug.endswith("-")


class TestCollisionsAreFine:
    def test_identical_titles_produce_identical_slugs(self):
        # This is the test that documents why there is NO unique constraint.
        # Five cities each running a "New Year's Eve Party" is not a conflict —
        # the uuid in the same path segment tells them apart, which is the whole
        # reason the URL is `{slug}-{uuid}` and not `{slug}`.
        assert event_slug("New Year's Eve Party") == event_slug("New Year's Eve Party")

    def test_a_reserved_route_word_is_harmless(self):
        # `GET /events/sitemap` exists. An event titled "Sitemap" produces
        # `sitemap`, which becomes `sitemap-{uuid}` in the URL and therefore
        # cannot shadow the route. Under a bare-slug scheme every future
        # `/events/<word>` route would be a word organizers could not use.
        assert event_slug("Sitemap") == "sitemap"
