/**
 * The event taxonomy — a MIRROR of `backend/apps/events/taxonomy.py`.
 *
 * ── WHY THIS IS DUPLICATED RATHER THAN FETCHED ────────────────────────────
 *
 * Both consumers need it before any request resolves: the create wizard draws
 * the picker, and the browse page draws its filter chips, and a chip row that
 * pops in after a round trip is a layout shift on the platform's busiest
 * public route. `lib/discovery/categories.ts` already has exactly this
 * arrangement with `EventCategory` for the same reason.
 *
 * The duplication is guarded rather than trusted: `backend/apps/events/tests/
 * test_taxonomy.py` READS THIS FILE and fails if a single slug differs. So a
 * value added on one side and forgotten on the other is a red test, not a
 * filter chip that silently matches nothing.
 *
 * ── NO ICON IMPORTS IN THIS FILE, EVER ────────────────────────────────────
 *
 * `lib/organizer/wizard/model.ts` imports it, and that module is pure and
 * framework-free — it is the draft model, covered by a vitest suite that
 * should not be loading an icon library. `categories.ts` imports eight lucide
 * icons at module scope, which is exactly why this one cannot follow it in
 * that respect. Any icon or artwork mapping belongs in the picker component.
 *
 * ── THE THREE LEVELS ARE DIFFERENT IN KIND ────────────────────────────────
 *
 * `category` is the browse nav (eight buckets, one landing page each).
 * `eventType` is the sub-classification — "Music & dance" covers a club night,
 * an open mic and a classical recital, and somebody after one is not served by
 * the other two. `tags` are what the event is LIKE rather than what it is.
 */

export type TaxonomyOption = {
  /** The stored slug. Also the URL filter value, so it must stay URL-safe. */
  readonly value: string;
  readonly label: string;
};

export type TagDimension = {
  readonly key: string;
  readonly label: string;
  /** One line under the heading, shown in the picker. */
  readonly help: string;
  readonly tags: readonly TaxonomyOption[];
};

/**
 * The sub-classification beneath a category.
 *
 * BLANK is a legal, distinct state meaning "not said" — it is not in this
 * list, and the picker offers it as an explicit "Not sure yet" rather than
 * leaving somebody unable to clear a choice they made by accident.
 */
export const EVENT_TYPES: readonly TaxonomyOption[] = [

  { value: 'music-jam', label: 'Music jam' },
  { value: 'concert', label: 'Concert' },
  { value: 'gig', label: 'Gig' },
  { value: 'open-mic', label: 'Open mic' },
  { value: 'dj-night', label: 'DJ night' },
  { value: 'club-night', label: 'Club night' },
  { value: 'comedy-show', label: 'Comedy show' },
  { value: 'theatre', label: 'Theatre' },
  { value: 'film-screening', label: 'Film screening' },
  { value: 'storytelling', label: 'Storytelling' },
  { value: 'art-workshop', label: 'Art workshop' },
  { value: 'craft-workshop', label: 'Craft workshop' },
  { value: 'pottery', label: 'Pottery' },
  { value: 'photography-walk', label: 'Photography walk' },
  { value: 'cooking-class', label: 'Cooking class' },
  { value: 'tasting', label: 'Tasting' },
  { value: 'food-festival', label: 'Food festival' },
  { value: 'supper-club', label: 'Supper club' },
  { value: 'hackathon', label: 'Hackathon' },
  { value: 'tech-talk', label: 'Tech talk' },
  { value: 'conference', label: 'Conference' },
  { value: 'panel-discussion', label: 'Panel discussion' },
  { value: 'meetup', label: 'Meetup' },
  { value: 'book-club', label: 'Book club' },
  { value: 'discussion-circle', label: 'Discussion circle' },
  { value: 'language-exchange', label: 'Language exchange' },
  { value: 'singles-social', label: 'Singles social' },
  { value: 'speed-dating', label: 'Speed dating' },
  { value: 'board-games', label: 'Board games' },
  { value: 'quiz-night', label: 'Quiz night' },
  { value: 'karaoke', label: 'Karaoke' },
  { value: 'city-walk', label: 'City walk' },
  { value: 'heritage-walk', label: 'Heritage walk' },
  { value: 'trek', label: 'Trek / hike' },
  { value: 'camping', label: 'Camping' },
  { value: 'cycling-ride', label: 'Cycling ride' },
  { value: 'run', label: 'Run' },
  { value: 'farm-visit', label: 'Farm visit' },
  { value: 'yoga', label: 'Yoga' },
  { value: 'fitness-class', label: 'Fitness class' },
  { value: 'wellness-session', label: 'Wellness session' },
  { value: 'retreat', label: 'Retreat' },
  { value: 'sports-tournament', label: 'Sports tournament' },
  { value: 'esports', label: 'Esports' },
  { value: 'exhibition', label: 'Exhibition' },
  { value: 'flea-market', label: 'Flea market' },
  { value: 'pop-up', label: 'Pop-up' },
  { value: 'kids-workshop', label: 'Kids workshop' },
] as const;


/** The seven axes, in the order the picker draws them. */
export const TAG_DIMENSIONS: readonly TagDimension[] = [

  {
    key: 'social',
    label: 'Who it suits',
    help: 'How people usually come to this.',
    tags: [
      { value: 'solo-friendly', label: 'Solo friendly' },
      { value: 'group-friendly', label: 'Group friendly' },
      { value: 'couples-friendly', label: 'Couples friendly' },
      { value: 'family-friendly', label: 'Family friendly' },
      { value: 'meet-new-people', label: 'Meet new people' },
      { value: 'networking', label: 'Networking' },
      { value: 'community-hosted', label: 'Community hosted' },
    ],
  },
  {
    key: 'format',
    label: 'What happens',
    help: 'The shape of the session itself.',
    tags: [
      { value: 'workshop', label: 'Workshop' },
      { value: 'meetup', label: 'Meetup' },
      { value: 'social-mixer', label: 'Social mixer' },
      { value: 'guided-experience', label: 'Guided experience' },
      { value: 'live-performance', label: 'Live performance' },
      { value: 'tournament', label: 'Tournament' },
      { value: 'pop-up', label: 'Pop-up' },
    ],
  },
  {
    key: 'level',
    label: 'Experience needed',
    help: 'So nobody arrives at the wrong level.',
    tags: [
      { value: 'no-experience-needed', label: 'No experience needed' },
      { value: 'beginner-friendly', label: 'Beginner friendly' },
      { value: 'intermediate', label: 'Intermediate' },
      { value: 'advanced', label: 'Advanced' },
      { value: 'instructor-led', label: 'Instructor led' },
    ],
  },
  {
    key: 'includes',
    label: 'What is included',
    help: 'Only what the ticket actually covers.',
    tags: [
      { value: 'food-included', label: 'Food included' },
      { value: 'drinks-included', label: 'Drinks included' },
      { value: 'materials-included', label: 'Materials included' },
      { value: 'equipment-provided', label: 'Equipment provided' },
      { value: 'take-home-creation', label: 'Take-home creation' },
      { value: 'giveaways', label: 'Giveaways' },
      { value: 'prizes', label: 'Prizes to win' },
    ],
  },
  {
    key: 'setting',
    label: 'Setting',
    help: 'Where people will actually be.',
    tags: [
      { value: 'indoor', label: 'Indoor' },
      { value: 'outdoor', label: 'Outdoor' },
      { value: 'rooftop', label: 'Rooftop' },
      { value: 'online', label: 'Online' },
    ],
  },
  {
    key: 'vibe',
    label: 'Vibe',
    help: 'What the room feels like.',
    tags: [
      { value: 'relaxed', label: 'Relaxed' },
      { value: 'high-energy', label: 'High energy' },
      { value: 'creative', label: 'Creative' },
      { value: 'competitive', label: 'Competitive' },
      { value: 'mindful', label: 'Mindful' },
      { value: 'intimate', label: 'Intimate' },
      { value: 'social', label: 'Social' },
    ],
  },
  {
    key: 'special',
    label: 'Anything else',
    help: 'Only if it is true — each of these is a promise.',
    tags: [
      { value: 'limited-seats', label: 'Limited seats' },
      { value: 'exclusive', label: 'Exclusive experience' },
      { value: 'local-experience', label: 'Local experience' },
      { value: 'kid-friendly', label: 'Kid friendly' },
      { value: 'pet-friendly', label: 'Pet friendly' },
    ],
  },
] as const;


/**
 * A hard ceiling, refused by the API. Ten tags is already more than a card can
 * show; past that they stop narrowing anything.
 */
export const MAX_TAGS = 10;

/**
 * Required to PUBLISH, never to save.
 *
 * The wizard autosaves on a keystroke, so a save-time minimum would mean
 * somebody who has typed a title cannot keep it while they think about tags.
 * This number belongs in `publishBlockers`, beside "at least one ticket type"
 * — never in `validate()`, which would paint the step red on an empty form.
 */
export const MIN_TAGS_TO_PUBLISH = 7;

/** Every legal tag slug, for validating a hand-edited URL or stored draft. */
export const ALL_TAGS: ReadonlySet<string> = new Set(
  TAG_DIMENSIONS.flatMap((dimension) => dimension.tags.map((tag) => tag.value)),
);

/** Every legal event-type slug. */
export const ALL_EVENT_TYPES: ReadonlySet<string> = new Set(
  EVENT_TYPES.map((type) => type.value),
);

const TAG_LABELS = new Map(
  TAG_DIMENSIONS.flatMap((dimension) => dimension.tags.map((tag) => [tag.value, tag.label])),
);

/**
 * The human label for a slug, or `null` when we do not recognise it.
 *
 * NULL rather than the raw slug: an unknown value is a retired tag or a
 * hand-edited URL, and rendering "beginner-frendly" as a chip presents our own
 * data as if it were correct. The caller omits it instead.
 */
export function tagLabel(slug: string): string | null {
  return TAG_LABELS.get(slug) ?? null;
}

const TYPE_LABELS = new Map(EVENT_TYPES.map((type) => [type.value, type.label]));

/** As `tagLabel`, for the sub-classification. */
export function eventTypeLabel(slug: string): string | null {
  return slug ? (TYPE_LABELS.get(slug) ?? null) : null;
}

/** Which dimension a tag belongs to, for grouping a saved selection. */
export function dimensionOf(slug: string): string | null {
  for (const dimension of TAG_DIMENSIONS) {
    if (dimension.tags.some((tag) => tag.value === slug)) return dimension.key;
  }
  return null;
}
