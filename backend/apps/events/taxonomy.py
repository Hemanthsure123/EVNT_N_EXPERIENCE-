"""The event taxonomy: what KIND of event this is, and what it is like.

Three levels, and they are deliberately different in kind:

- ``Event.category`` (``EventCategory``, models.py) is the BROWSE taxonomy —
  eight buckets, one per landing page, one per homepage tile. It is the
  coarsest possible split and it exists to make a nav.
- ``Event.event_type`` (``EventType``, here) is the sub-classification. "Music
  & dance" covers a club night, an open mic and a classical recital, and
  somebody looking for one of those is not served by the other two.
- ``Event.tags`` (``TAG_DIMENSIONS``, here) is what the event is LIKE rather
  than what it is: who it suits, what is included, how it feels.

**None of them is a free-text field, and that is the whole point.** A tag is a
FILTER: it is only worth collecting because a browse page can offer it, which
means the vocabulary has to be closed and shared. Free text would give every
organizer their own spelling of "beginner friendly" and nothing to filter on.

**Blank is a legal, distinct state for ``event_type``.** It means "the
organizer has not said", which is different from any value in the list — the
same split ``EventCategory`` documents. Nothing refuses a draft for it.

── THE FRONTEND HOLDS A MIRROR OF THIS FILE ──────────────────────────────

``frontend/lib/events/taxonomy.ts``. It has to: the wizard renders the picker
and the browse page renders the filter chips, both at build time, and neither
can wait on a round trip to learn what a tag is. That is the same arrangement
``lib/discovery/categories.ts`` already has with ``EventCategory``.

The duplication is real and is guarded by ``test_taxonomy.py``, which pins
every slug in this file. A slug added on one side and not the other is then a
failing test rather than a filter chip that silently matches nothing.
"""

from __future__ import annotations

from django.db import models


class EventType(models.TextChoices):
    """The sub-classification beneath ``Event.category``.

    ``max_length`` on the column is 40 rather than ``category``'s 20: the
    longest slug here is ``photography-walk`` today, and this list is certain
    to grow. A value longer than the column raises ``DataError`` at write time
    in production Postgres and nowhere else, so it is sized once, generously.

    Adding a value here generates an ``AlterField`` migration — ``choices`` is
    baked into the migration file. That is a CI gate (``makemigrations
    --check``), not an optional tidy-up.
    """

    # Music & nightlife
    MUSIC_JAM = "music-jam", "Music jam"
    CONCERT = "concert", "Concert"
    GIG = "gig", "Gig"
    OPEN_MIC = "open-mic", "Open mic"
    DJ_NIGHT = "dj-night", "DJ night"
    CLUB_NIGHT = "club-night", "Club night"
    # Stage & screen
    COMEDY_SHOW = "comedy-show", "Comedy show"
    THEATRE = "theatre", "Theatre"
    FILM_SCREENING = "film-screening", "Film screening"
    STORYTELLING = "storytelling", "Storytelling"
    # Making things
    ART_WORKSHOP = "art-workshop", "Art workshop"
    CRAFT_WORKSHOP = "craft-workshop", "Craft workshop"
    POTTERY = "pottery", "Pottery"
    PHOTOGRAPHY_WALK = "photography-walk", "Photography walk"
    # Food & drink
    COOKING_CLASS = "cooking-class", "Cooking class"
    TASTING = "tasting", "Tasting"
    FOOD_FESTIVAL = "food-festival", "Food festival"
    SUPPER_CLUB = "supper-club", "Supper club"
    # Ideas & tech
    HACKATHON = "hackathon", "Hackathon"
    TECH_TALK = "tech-talk", "Tech talk"
    CONFERENCE = "conference", "Conference"
    PANEL_DISCUSSION = "panel-discussion", "Panel discussion"
    MEETUP = "meetup", "Meetup"
    # Talking & reading
    BOOK_CLUB = "book-club", "Book club"
    DISCUSSION_CIRCLE = "discussion-circle", "Discussion circle"
    LANGUAGE_EXCHANGE = "language-exchange", "Language exchange"
    # Meeting people
    SINGLES_SOCIAL = "singles-social", "Singles social"
    SPEED_DATING = "speed-dating", "Speed dating"
    BOARD_GAMES = "board-games", "Board games"
    QUIZ_NIGHT = "quiz-night", "Quiz night"
    KARAOKE = "karaoke", "Karaoke"
    # Outdoors
    CITY_WALK = "city-walk", "City walk"
    HERITAGE_WALK = "heritage-walk", "Heritage walk"
    TREK = "trek", "Trek / hike"
    CAMPING = "camping", "Camping"
    CYCLING_RIDE = "cycling-ride", "Cycling ride"
    RUN = "run", "Run"
    FARM_VISIT = "farm-visit", "Farm visit"
    # Body & mind
    YOGA = "yoga", "Yoga"
    FITNESS_CLASS = "fitness-class", "Fitness class"
    WELLNESS_SESSION = "wellness-session", "Wellness session"
    RETREAT = "retreat", "Retreat"
    # Competing
    SPORTS_TOURNAMENT = "sports-tournament", "Sports tournament"
    ESPORTS = "esports", "Esports"
    # Browsing
    EXHIBITION = "exhibition", "Exhibition"
    FLEA_MARKET = "flea-market", "Flea market"
    POP_UP = "pop-up", "Pop-up"
    KIDS_WORKSHOP = "kids-workshop", "Kids workshop"


#: The longest slug, asserted in tests so the column length cannot silently
#: become too small when somebody adds "international-food-festival".
EVENT_TYPE_MAX_LENGTH = 40


class TagDimension:
    """One axis of the tag matrix. A plain class, not a model.

    These are a vocabulary, not data an operator edits — unlike
    ``cms.FeaturedCity``, which IS curation and therefore IS a table. A tag has
    to be in the frontend bundle for the filter chips to render, so a database
    row would have to be mirrored into the bundle anyway and could then drift
    from it. See the module docstring.
    """

    __slots__ = ("key", "label", "help_text", "tags")

    def __init__(self, key: str, label: str, help_text: str, tags: dict[str, str]) -> None:
        self.key = key
        self.label = label
        self.help_text = help_text
        self.tags = tags


#: The seven dimensions, in the order the picker draws them.
#:
#: Ordered from "who is this for" outward to "anything else", because that is
#: the order an organizer can answer them in: the first two are facts about the
#: event they already know, and the last is a residue.
TAG_DIMENSIONS: tuple[TagDimension, ...] = (
    TagDimension(
        "social",
        "Who it suits",
        "How people usually come to this.",
        {
            "solo-friendly": "Solo friendly",
            "group-friendly": "Group friendly",
            "couples-friendly": "Couples friendly",
            "family-friendly": "Family friendly",
            "meet-new-people": "Meet new people",
            "networking": "Networking",
            "community-hosted": "Community hosted",
        },
    ),
    TagDimension(
        "format",
        "What happens",
        "The shape of the session itself.",
        {
            "workshop": "Workshop",
            "meetup": "Meetup",
            "social-mixer": "Social mixer",
            "guided-experience": "Guided experience",
            "live-performance": "Live performance",
            "tournament": "Tournament",
            "pop-up": "Pop-up",
        },
    ),
    TagDimension(
        "level",
        "Experience needed",
        "So nobody arrives at the wrong level.",
        {
            "no-experience-needed": "No experience needed",
            "beginner-friendly": "Beginner friendly",
            "intermediate": "Intermediate",
            "advanced": "Advanced",
            "instructor-led": "Instructor led",
        },
    ),
    TagDimension(
        "includes",
        "What is included",
        "Only what the ticket actually covers.",
        {
            "food-included": "Food included",
            "drinks-included": "Drinks included",
            "materials-included": "Materials included",
            "equipment-provided": "Equipment provided",
            "take-home-creation": "Take-home creation",
            "giveaways": "Giveaways",
            "prizes": "Prizes to win",
        },
    ),
    TagDimension(
        "setting",
        "Setting",
        "Where people will actually be.",
        {
            "indoor": "Indoor",
            "outdoor": "Outdoor",
            "rooftop": "Rooftop",
            "online": "Online",
        },
    ),
    TagDimension(
        "vibe",
        "Vibe",
        "What the room feels like.",
        {
            "relaxed": "Relaxed",
            "high-energy": "High energy",
            "creative": "Creative",
            "competitive": "Competitive",
            "mindful": "Mindful",
            "intimate": "Intimate",
            "social": "Social",
        },
    ),
    TagDimension(
        "special",
        "Anything else",
        "Only if it is true — each of these is a promise.",
        {
            "limited-seats": "Limited seats",
            "exclusive": "Exclusive experience",
            "local-experience": "Local experience",
            "kid-friendly": "Kid friendly",
            "pet-friendly": "Pet friendly",
        },
    ),
)

#: Every legal tag slug. Membership is checked at the API boundary, so a
#: hand-edited payload cannot put an unfilterable string on an event.
ALL_TAGS: frozenset[str] = frozenset(
    slug for dimension in TAG_DIMENSIONS for slug in dimension.tags
)

#: Which dimension each tag belongs to — the reverse index the "at least one
#: from N dimensions" rule needs, built once rather than scanned per call.
TAG_DIMENSION_BY_TAG: dict[str, str] = {
    slug: dimension.key for dimension in TAG_DIMENSIONS for slug in dimension.tags
}

#: A hard ceiling, refused at the boundary. Ten tags is already more than a
#: card can show; past that they stop narrowing anything and the matrix becomes
#: a way to appear in every filter at once.
MAX_TAGS = 10

#: Required to PUBLISH, never to save. A draft with two tags saves perfectly
#: well — the wizard is local-first and autosaves on a keystroke, so a
#: save-time minimum would mean somebody who has typed a title cannot keep it
#: while they think about tags. The gate belongs where completeness is already
#: decided, next to "has at least one ticket type".
MIN_TAGS_TO_PUBLISH = 7


def unknown_tags(tags: list[str]) -> list[str]:
    """The submitted tags that are not in the vocabulary, in submitted order.

    Returned rather than raised so the caller can name ALL of them at once. A
    boundary that refuses one unknown value at a time makes a client fix a list
    by trial and error.
    """
    return [tag for tag in tags if tag not in ALL_TAGS]


def dimensions_covered(tags: list[str]) -> set[str]:
    """Which of the seven axes these tags touch."""
    return {TAG_DIMENSION_BY_TAG[tag] for tag in tags if tag in TAG_DIMENSION_BY_TAG}
