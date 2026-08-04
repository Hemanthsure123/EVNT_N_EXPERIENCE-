/**
 * The event draft: what the Studio edits, and how it maps to the API.
 *
 * ── WHAT THE BACKEND ACTUALLY STORES ──────────────────────────────────────
 *
 * `POST /events` takes `organization_id`, `title`, `description`, `venue`,
 * `city`, `starts_at`, `ends_at` and a `poster` file. `PATCH /events/{id}`
 * takes those plus the seven content fields (`short_description`,
 * `duration_minutes`, `language`, `age_restriction`, `accessibility_notes`,
 * `seo_title`, `seo_description`). Both also take `place_id`, `latitude` and
 * `longitude` — which Google place the venue is, and where its pin goes. Those
 * three are written together by the venue picker and cleared together, and the
 * serializer refuses HALF a coordinate pair (`_validate_coordinate_pair`), so
 * the mapping below never sends one without the other. Gallery images, FAQs and
 * the running order are their own endpoints under `/events/{id}/…` and are
 * edited directly against the server rather than held in this draft — see below.
 *
 * So this model has exactly those fields and no others. The brief asked for a
 * good many more — category, tags, street address, state, country, pin code,
 * venue capacity, timezone, doors-open time, recurrence, per-tier
 * descriptions, perks, visibility and refundability, and nine kinds of policy
 * text. **None of those columns exist.** Collecting them into a form that then
 * discards them on save is worse than not offering them: the organizer would
 * believe their refund policy was published when nothing had been stored, and
 * would find out from an attendee.
 *
 * Each omission is listed in `frontend/BACKLOG.md` against the migration it
 * needs. Two are cheap and would unlock a lot (`Event.category`, a policies
 * JSON blob); the rest are a venues module.
 *
 * ── WHY MEDIA, FAQS AND THE RUNNING ORDER ARE NOT IN THE DRAFT ────────────
 *
 * They are collections with their own create/delete endpoints, keyed on an
 * event that must already exist. Mirroring them into this local-first draft
 * would mean inventing a reconciliation ("which of these five FAQs are new?")
 * for no benefit — an organizer reaches those steps after the draft has saved.
 * They are edited server-side, with TanStack Query as the cache, and the steps
 * say plainly that they unlock once the draft exists.
 *
 * ── WHAT IS DERIVED RATHER THAN STORED ────────────────────────────────────
 *
 * The SEO preview is real — it renders what `lib/seo/metadata.ts` will
 * actually emit for this event, falling back from `seo_title` to `title`
 * exactly as the server-rendered page does. There is deliberately NO slug
 * preview: the public route is `/events/{uuid}` (see `app/(site)/events/[id]`),
 * so a slug would be a picture of a URL that will never exist.
 */

import type {
  CreateEventInput,
  CreateTicketTypeInput,
  SalePhaseInput,
  UpdateEventInput,
} from '@/lib/api/organizer-writes';

/**
 * One step of a tier's pricing schedule, as edited.
 *
 * There is deliberately no `serverId`: the write replaces the whole schedule by
 * array order (see `SalePhaseInput`), so a phase has no identity to preserve
 * across a save and pretending otherwise would invite a per-phase patch the API
 * does not offer.
 */
export type DraftPhase = {
  /** Client-side only — React's list key and the remove button's handle. */
  key: string;
  name: string;
  /** MAJOR units (rupees) while editing, exactly like the tier's own price. */
  price: string;
  /** `datetime-local`. Blank means the phase is bounded by seats alone. */
  endsAt: string;
  /** CUMULATIVE sold-or-held threshold — the first N seats of the TIER, not N
   *  seats allocated to this phase. Blank means bounded by the deadline alone. */
  quantity: string;
};

export type DraftTier = {
  /** Client-side id. Becomes the server's id once the tier is created. */
  key: string;
  /** Set once this tier exists on the server. */
  serverId?: string;
  /** Optimistic-lock version, present only for server-backed tiers. */
  version?: number;
  name: string;
  /** MAJOR units (rupees) while editing — converted at the boundary. Editing
   *  in paise means an organizer types 49900 and means ₹499. */
  price: string;
  quantity: string;
  maxPerOrder: string;
  saleStart: string;
  saleEnd: string;
  /** The sale-phase schedule, in position order. Empty means "one price". */
  phases: DraftPhase[];
};

export type Draft = {
  /** Set once `POST /events` has run. Null while the draft is local-only. */
  eventId: string | null;
  /** Optimistic-lock version from the last server response. */
  version: number;
  organizationId: string;
  title: string;
  description: string;
  venue: string;
  city: string;
  /**
   * Google's id for the venue, or `''` when it was typed freehand.
   *
   * Non-empty means the coordinates below are GOOGLE'S for that place. Placing
   * the pin by hand clears it, which keeps that one invariant true — see
   * `VenueStep`, where both halves are written.
   */
  placeId: string;
  /** The pin. Null — never 0 — when there is no pin: (0, 0) is a real place in
   *  the Atlantic, and the event page renders a map only when both are set.
   *  Rounded to 7dp by whoever writes them, matching the column. */
  latitude: number | null;
  longitude: number | null;
  /** `datetime-local` strings, i.e. local wall time with no zone. */
  startsAt: string;
  endsAt: string;
  posterUrl: string;
  /* Content fields — all optional, all blank-able. */
  shortDescription: string;
  /** Kept as a string because that is what a number input yields; "" means
   *  "not stated" and maps to `null`, never to 0. */
  durationMinutes: string;
  language: string;
  ageRestriction: string;
  accessibilityNotes: string;
  seoTitle: string;
  seoDescription: string;
  tiers: DraftTier[];
};

export const STEPS = [
  { id: 'basics', label: 'Basics', hint: 'Title and description' },
  { id: 'venue', label: 'Venue', hint: 'Where it happens' },
  { id: 'schedule', label: 'Schedule', hint: 'Dates and running order' },
  { id: 'tickets', label: 'Tickets', hint: 'Tiers, prices and capacity' },
  { id: 'media', label: 'Media', hint: 'Cover and gallery' },
  { id: 'details', label: 'Details', hint: 'Duration, age, access, FAQs' },
  { id: 'seo', label: 'Search', hint: 'How it appears in results' },
  { id: 'review', label: 'Review', hint: 'Check and publish' },
] as const;

export type StepId = (typeof STEPS)[number]['id'];

/** Steps whose content is edited directly on the server, so they need a saved
 *  draft before they do anything. The Studio says so rather than failing. */
export const SERVER_BACKED_STEPS: readonly StepId[] = ['media', 'details'];

export function emptyDraft(organizationId = ''): Draft {
  return {
    eventId: null,
    version: 1,
    organizationId,
    title: '',
    description: '',
    venue: '',
    city: '',
    placeId: '',
    latitude: null,
    longitude: null,
    startsAt: '',
    endsAt: '',
    posterUrl: '',
    shortDescription: '',
    durationMinutes: '',
    language: '',
    ageRestriction: '',
    accessibilityNotes: '',
    seoTitle: '',
    seoDescription: '',
    tiers: [],
  };
}

/* ────────────────────── which organisation owns it ────────────────────── */

/**
 * The draft's autosave key, namespaced by account.
 *
 * It used to be one global `ee-event-draft-v1`, which is how a browser shared
 * between two accounts leaked a draft: whoever opened the Studio next restored
 * the other person's half-written event, `organizationId` and all, and every
 * save then posted an organisation they did not own — `POST /events` refusing
 * with "Only the owning organization can manage this event."
 *
 * Namespacing is the fix rather than clearing on sign-out, for two reasons.
 * Clearing only helps if sign-out actually happens (a shared machine is
 * usually a closed tab, not a sign-out), and it throws away the draft of
 * somebody who signs out and back in as THEMSELVES — which is the common case
 * and the one "never lose work" was written for. A per-account key survives
 * that and cannot leak across accounts even if nobody ever signs out.
 */
const STORAGE_PREFIX = 'ee-event-draft-v2';

/**
 * The old global key. Read by nobody now; deleted on first hydrate so a copy
 * of somebody's draft does not sit in shared storage forever.
 *
 * It is deliberately NOT migrated into the current account's namespace —
 * adopting it is precisely the leak this change removes, and there is no way
 * to tell whose it was. The loss is bounded: a draft complete enough to have
 * been created lives on the server and is in `/dashboard/events`; only
 * pre-creation local scraps go, once.
 */
const LEGACY_STORAGE_KEY = 'ee-event-draft-v1';

export function draftStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

export function discardLegacyDraft(): void {
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Blocked or private storage. Nothing to clean up if it was never written.
  }
}

/**
 * Which organisation a draft may be created under.
 *
 * `GET /organizations/` returns exactly the ones this account owns, and
 * `EventService.create_event` refuses anything else — so an id that is not in
 * that list is not a preference to honour, it is a request the API will
 * reject. The rule:
 *
 * - a candidate the account owns is kept, always;
 * - otherwise, if the account owns exactly ONE organisation, that one is
 *   adopted — there is nothing to choose between, so a picker would be a
 *   question with a single answer;
 * - otherwise `''`, which `canCreate` treats as "not creatable yet" and
 *   `validate` reports as something to fix. With several organisations to
 *   choose from, picking the first is a GUESS, and the cost of guessing wrong
 *   is an event — and its payouts — attached to the wrong company.
 */
export function resolveOrganizationId(candidate: string, owned: readonly string[]): string {
  if (candidate && owned.includes(candidate)) return candidate;
  return owned.length === 1 ? owned[0] : '';
}

/**
 * Rebuild a draft from whatever `localStorage` holds.
 *
 * Merged onto a fresh draft rather than used as-is. A draft written by an
 * older build has none of the fields added since, and
 * `draft.shortDescription.trim()` on an `undefined` is a white screen holding
 * someone's half-written event. The merge is also why the storage key does not
 * need bumping on every field: nothing is lost.
 *
 * `organizationId` is the one field the stored copy does NOT get to decide —
 * it is re-resolved against what the account owns on every restore, because
 * an organisation can be handed over, renamed or soft-deleted between
 * sessions, and a stale id here is the "Only the owning organization can
 * manage this event." error rather than a cosmetic mismatch.
 *
 * A draft that has ALREADY been created on the server under an organisation
 * this account does not own is discarded outright instead of repointed:
 * `organization_id` is set at `POST /events` and is not in the PATCH body, so
 * repointing would leave the wizard patching an event it cannot touch — a 403
 * on every autosave with no way out but clearing storage by hand. Dropping it
 * is recoverable; the event itself still exists for whoever does own it.
 */
export function restoreDraft(
  stored: Partial<Draft> | null | undefined,
  owned: readonly string[],
): Draft {
  const fresh = emptyDraft(resolveOrganizationId('', owned));
  if (!stored) return fresh;

  const organizationId = resolveOrganizationId(stored.organizationId ?? '', owned);
  if (stored.eventId && organizationId !== stored.organizationId) return fresh;

  return {
    ...fresh,
    ...stored,
    organizationId,
    // Each tier is normalised for the same reason the draft itself is merged
    // onto a fresh one: a tier written before phases existed has no `phases`
    // array, and `tier.phases.map(...)` on an `undefined` is a white screen
    // holding somebody's half-written event.
    tiers: Array.isArray(stored.tiers)
      ? stored.tiers.map((tier) => ({ ...tier, phases: Array.isArray(tier.phases) ? tier.phases : [] }))
      : [],
  };
}

export function newTier(index: number): DraftTier {
  return {
    key: `tier-${index}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    price: '',
    quantity: '',
    maxPerOrder: '10',
    saleStart: '',
    saleEnd: '',
    phases: [],
  };
}

export function newPhase(index: number): DraftPhase {
  return {
    key: `phase-${index}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    price: '',
    endsAt: '',
    quantity: '',
  };
}

/* ─────────────────────────── validation ─────────────────────────── */

export type Issue = { step: StepId; field: string; message: string };

export const TITLE_MAX = 200;
export const VENUE_MAX = 255;
export const CITY_MAX = 120;
/** No column limit on `description` (it is a TextField), so this is an
 *  editorial cap, not a database one — and it is labelled that way. */
export const DESCRIPTION_SOFT_MAX = 2000;

/* Content-field caps. Every one is the column's own `max_length`, so the
 * counter turns red at exactly the point the API would refuse. */
export const SHORT_DESCRIPTION_MAX = 200;
export const LANGUAGE_MAX = 80;
export const AGE_RESTRICTION_MAX = 60;
export const ACCESSIBILITY_MAX = 500;
/** 70 and 160 are Google's own truncation points, and they are what the
 *  columns were sized to — the counter and the search preview agree. */
export const SEO_TITLE_MAX = 70;
export const SEO_DESCRIPTION_MAX = 160;
/** 30 days. `PositiveIntegerField`, so 0 is storable but meaningless. */
export const DURATION_MAX_MINUTES = 60 * 24 * 30;

/** `TicketingService.MAX_PHASES`. A schedule is a handful of named steps, not
 *  a curve, and the service raises `InvalidPhaseScheduleError` past this. */
export const MAX_PHASES = 5;
/** `SalePhase.name`'s own `max_length`. */
export const PHASE_NAME_MAX = 40;

/**
 * Every rule `_validate_phase_schedule` enforces, as sentences.
 *
 * It is a separate exported function rather than inline in `validate()` because
 * the save engine needs the same answer: a tier whose schedule the server would
 * refuse must not be SENT (see `tierIsSavable`), or every autosave from that
 * keystroke on is a 400 the organizer cannot act on.
 *
 * Prices are compared in MINOR units, the same conversion `toTierInput` does —
 * comparing the rupee strings would make "500" and "500.00" different numbers
 * and 0.1 + 0.2 decide whether a schedule is legal.
 */
export function phaseIssues(tier: DraftTier): string[] {
  const problems: string[] = [];
  const where = tier.name.trim() || 'This ticket';
  if (tier.phases.length > MAX_PHASES) {
    problems.push(`${where}: at most ${MAX_PHASES} pricing phases.`);
  }

  const facePrice = toMinor(tier.price);
  let previous: number | null = null;
  tier.phases.forEach((phase, index) => {
    const label = phase.name.trim() || `Phase ${index + 1}`;
    if (!phase.name.trim()) {
      problems.push(`${where}: phase ${index + 1} needs a name.`);
    } else if (phase.name.length > PHASE_NAME_MAX) {
      problems.push(`${where}: "${label}" is capped at ${PHASE_NAME_MAX} characters.`);
    }

    const price = toMinor(phase.price);
    if (phase.price === '' || !Number.isFinite(price) || price < 1) {
      // > 0, matching the serializer: a free phase is a different product, not
      // a discount, and the tier's own price is where "free" is expressed.
      problems.push(`${where}: "${label}" needs a price above ₹0.`);
    } else {
      if (Number.isFinite(facePrice) && tier.price !== '' && price > facePrice) {
        // The server IGNORES a phase priced above face price rather than
        // billing it, so this can never overcharge anybody — but a phase that
        // silently does nothing is worse than one that is refused.
        problems.push(`${where}: "${label}" costs more than the ticket's own price.`);
      }
      if (previous !== null && price < previous) {
        problems.push(`${where}: "${label}" is cheaper than the phase before it.`);
      }
      previous = price;
    }

    if (!phase.endsAt && !phase.quantity) {
      problems.push(`${where}: "${label}" needs an end time or a seat cap.`);
    }
    if (phase.quantity) {
      const cap = Number(phase.quantity);
      if (!Number.isInteger(cap) || cap < 1) {
        problems.push(`${where}: "${label}" needs a whole seat cap of at least 1.`);
      }
    }
  });
  return problems;
}

/**
 * Whether this tier may be SENT to the API yet.
 *
 * The save engine's gate, and it has to include the schedule. A phase is typed
 * one field at a time, so for as long as it takes to fill in four inputs the
 * tier carries a schedule the serializer refuses — a phase with a blank name, or
 * no price, or neither bound. Sending it means every autosave from that
 * keystroke until the last one is a 400, on the screen whose entire promise is
 * that work is never lost, with nothing the organizer can act on: the tier's own
 * fields are all valid.
 *
 * So an incomplete schedule makes the tier unsavable rather than unsendable-and-
 * failing, exactly as an unnamed tier already does. `phaseIssues` is the single
 * statement of the rules; this is the one place that turns them into a verdict.
 */
export function tierIsSavable(tier: DraftTier): boolean {
  return Boolean(
    tier.name.trim() &&
      tier.price !== '' &&
      Number(tier.quantity) >= 1 &&
      phaseIssues(tier).length === 0,
  );
}

/** Rupees typed in a field -> integer paise. Exported nowhere: the two callers
 *  that need it are in this module, and one of them is the API boundary. */
function toMinor(rupees: string): number {
  return Math.round(Number(rupees) * 100);
}

/**
 * Every rule here mirrors one the backend enforces, so the wizard never lets
 * through something the API will reject — and never blocks something it would
 * have accepted. `starts_at must be in the future` and `ends_at must be after
 * starts_at` are `CreateEventRequestSerializer`'s own validators; the tier
 * rules are `CreateTicketTypeRequestSerializer`'s.
 */
export function validate(draft: Draft, now = new Date()): Issue[] {
  const issues: Issue[] = [];

  // Reachable only when the account owns MORE THAN ONE organisation and has
  // not said which — a single organisation is adopted automatically, and one
  // that is not owned is never carried this far. Without this the wizard just
  // stopped saving: `canCreate` was false, the badge said "Saved on this
  // device", and nothing on screen said why.
  if (!draft.organizationId) {
    issues.push({
      step: 'basics',
      field: 'organizationId',
      message: 'Choose which organisation is running this event.',
    });
  }

  if (!draft.title.trim()) {
    issues.push({ step: 'basics', field: 'title', message: 'A title is required.' });
  } else if (draft.title.length > TITLE_MAX) {
    issues.push({
      step: 'basics',
      field: 'title',
      message: `Titles are capped at ${TITLE_MAX} characters.`,
    });
  }

  if (!draft.venue.trim()) {
    issues.push({ step: 'venue', field: 'venue', message: 'A venue is required.' });
  } else if (draft.venue.length > VENUE_MAX) {
    issues.push({ step: 'venue', field: 'venue', message: `Capped at ${VENUE_MAX} characters.` });
  }
  if (!draft.city.trim()) {
    issues.push({ step: 'venue', field: 'city', message: 'A city is required.' });
  } else if (draft.city.length > CITY_MAX) {
    issues.push({ step: 'venue', field: 'city', message: `Capped at ${CITY_MAX} characters.` });
  }

  if (!draft.startsAt) {
    issues.push({ step: 'schedule', field: 'startsAt', message: 'A start time is required.' });
  } else {
    const starts = new Date(draft.startsAt);
    if (Number.isNaN(starts.valueOf())) {
      issues.push({ step: 'schedule', field: 'startsAt', message: 'That is not a valid date.' });
    } else if (starts <= now) {
      // The backend rejects this outright, so catching it here saves a round
      // trip that would otherwise land as a red banner after autosave.
      issues.push({
        step: 'schedule',
        field: 'startsAt',
        message: 'The start time has to be in the future.',
      });
    }
  }
  if (draft.endsAt && draft.startsAt) {
    if (new Date(draft.endsAt) <= new Date(draft.startsAt)) {
      issues.push({
        step: 'schedule',
        field: 'endsAt',
        message: 'The end time has to be after the start.',
      });
    }
  }

  // Content fields. Only length and range are checked — every one is
  // optional, so "empty" is never an issue. The caps mirror the columns, so
  // the counter turning red and the API refusing happen at the same character.
  const capped: Array<[StepId, string, string, number]> = [
    ['details', 'shortDescription', draft.shortDescription, SHORT_DESCRIPTION_MAX],
    ['details', 'language', draft.language, LANGUAGE_MAX],
    ['details', 'ageRestriction', draft.ageRestriction, AGE_RESTRICTION_MAX],
    ['details', 'accessibilityNotes', draft.accessibilityNotes, ACCESSIBILITY_MAX],
    ['seo', 'seoTitle', draft.seoTitle, SEO_TITLE_MAX],
    ['seo', 'seoDescription', draft.seoDescription, SEO_DESCRIPTION_MAX],
  ];
  for (const [step, field, value, max] of capped) {
    if (value.length > max) {
      issues.push({ step, field, message: `Capped at ${max} characters.` });
    }
  }

  if (draft.durationMinutes !== '') {
    const minutes = Number(draft.durationMinutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > DURATION_MAX_MINUTES) {
      issues.push({
        step: 'details',
        field: 'durationMinutes',
        message: 'Give a whole number of minutes, or leave it blank.',
      });
    }
  }

  draft.tiers.forEach((tier, index) => {
    const where = tier.name.trim() || `Ticket ${index + 1}`;
    if (!tier.name.trim()) {
      issues.push({ step: 'tickets', field: tier.key, message: `${where} needs a name.` });
    }
    const price = Number(tier.price);
    if (tier.price === '' || Number.isNaN(price) || price < 0) {
      issues.push({
        step: 'tickets',
        field: tier.key,
        message: `${where} needs a price (0 for free).`,
      });
    }
    const quantity = Number(tier.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      issues.push({
        step: 'tickets',
        field: tier.key,
        message: `${where} needs a quantity of at least 1.`,
      });
    }
    if (tier.saleStart && tier.saleEnd && new Date(tier.saleEnd) <= new Date(tier.saleStart)) {
      issues.push({
        step: 'tickets',
        field: tier.key,
        message: `${where}: sales must end after they start.`,
      });
    }
    // Keyed on the tier, so the schedule's problems appear inside the card that
    // holds it rather than in a list somewhere else on the step.
    for (const message of phaseIssues(tier)) {
      issues.push({ step: 'tickets', field: tier.key, message });
    }
  });

  return issues;
}

/**
 * The publish gate, mirrored client-side.
 *
 * `apps/events/publish_checks.py` runs a registered list before draft→live,
 * and `ticketing` registers "has at least one ticket type". Showing that here
 * lets the Review step say WHY publish is disabled instead of offering a
 * button that fails. The server still enforces it — this is a mirror, not a
 * replacement, and if a check is added server-side the API will still refuse.
 */
/**
 * The unsaved-draft blocker, exported by name so the Review step can recognise
 * it and append the live CAUSE (the save error, the missing field, or
 * "offline") underneath. The string itself stays static here — this module is
 * pure and has no access to the save engine's state.
 */
export const UNSAVED_DRAFT_BLOCKER = 'The draft has not been saved yet.';

export function publishBlockers(
  draft: Draft,
  /** The caller's organisations, with the level the server gates on. Optional
   *  so existing callers keep working; when absent the verification clause is
   *  simply not mirrored, which is the old (weaker) behaviour rather than a
   *  wrong one. */
  organizations?: readonly { id: string; name: string; verified_level: string }[],
): string[] {
  const blockers: string[] = [];
  if (!draft.eventId) blockers.push(UNSAVED_DRAFT_BLOCKER);

  // THE GATE THE SERVER APPLIES FIRST, AND THE ONE THIS USED TO MISS.
  //
  // `publish_event` refuses an unverified organisation before it runs a single
  // readiness check. Mirroring only the readiness checks meant somebody could
  // complete eight steps, watch every item on the review checklist turn green,
  // press Submit, and be told their organisation is not verified — a fact that
  // was knowable before they typed the title. It is stated here, at the top,
  // because it is not something they can fix on this screen.
  const organization = organizations?.find((entry) => entry.id === draft.organizationId);
  if (organization && organization.verified_level !== 'verified') {
    blockers.push(
      organization.verified_level === 'pending'
        ? `${organization.name} is still being verified. You can keep editing; submit once it is approved.`
        : `${organization.name} needs to be verified before it can put an event on sale.`,
    );
  }

  if (draft.tiers.length === 0) blockers.push('Add at least one ticket type.');
  if (draft.tiers.some((tier) => !tier.serverId)) {
    blockers.push('One or more ticket types have not saved yet.');
  }

  // The server's `_require_future_start`. A draft left alone long enough
  // becomes unpublishable purely by its start time passing, and without this
  // the only notice is a failed submit.
  if (draft.startsAt && Date.parse(draft.startsAt) <= Date.now()) {
    blockers.push('The start time has already passed. Pick a new date before submitting.');
  }
  return blockers;
}

/** Which steps are complete, for the rail's check marks. */
export function stepStatus(
  draft: Draft,
  issues: Issue[],
): Record<StepId, 'done' | 'todo' | 'error'> {
  const has = (step: StepId) => issues.some((issue) => issue.step === step);
  const touched: Record<StepId, boolean> = {
    basics: Boolean(draft.title.trim()),
    venue: Boolean(draft.venue.trim() || draft.city.trim()),
    schedule: Boolean(draft.startsAt),
    tickets: draft.tiers.length > 0,
    // Media is genuinely optional — the backend has no poster requirement, so
    // marking it "done" only once an image exists would nag about a step that
    // never blocks anything.
    media: Boolean(draft.posterUrl),
    // "Done" means the organizer said something, not that they filled in every
    // field: an event with no age restriction is a complete event.
    details: Boolean(
      draft.shortDescription.trim() ||
        draft.durationMinutes ||
        draft.language.trim() ||
        draft.ageRestriction.trim() ||
        draft.accessibilityNotes.trim(),
    ),
    seo: Boolean(draft.seoTitle.trim() || draft.seoDescription.trim()),
    review: false,
  };
  const out = {} as Record<StepId, 'done' | 'todo' | 'error'>;
  for (const step of STEPS) {
    out[step.id] = has(step.id) ? 'error' : touched[step.id] ? 'done' : 'todo';
  }
  out.review = publishBlockers(draft).length === 0 && issues.length === 0 ? 'done' : 'todo';
  return out;
}

/** 0–100, weighted by the steps that actually gate a publish. */
export function completion(draft: Draft): number {
  const checks = [
    Boolean(draft.title.trim()),
    Boolean(draft.venue.trim()),
    Boolean(draft.city.trim()),
    Boolean(draft.startsAt),
    draft.tiers.length > 0,
    Boolean(draft.posterUrl),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

/* ─────────────────────────── API mapping ─────────────────────────── */

/** `datetime-local` has no zone; the browser's own offset is the honest
 *  interpretation of what the organizer typed. */
export function toIso(local: string): string {
  return local ? new Date(local).toISOString() : '';
}

export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** True once `POST /events` has everything its serializer requires. */
export function canCreate(draft: Draft): boolean {
  return Boolean(
    draft.organizationId &&
      draft.title.trim() &&
      draft.venue.trim() &&
      draft.city.trim() &&
      draft.startsAt &&
      new Date(draft.startsAt) > new Date(),
  );
}

/**
 * Where the venue is, in the shape the serializer demands: both coordinates or
 * neither.
 *
 * `_validate_coordinate_pair` 400s a lone latitude, and a 400 here is not a
 * cosmetic failure — it is EVERY autosave on the draft refused until somebody
 * clears their browser storage. The venue picker only ever writes the pair, but
 * a draft restored from an older build, or a hand-edited `localStorage`, can
 * hold half of one, so the pair is normalised at the boundary rather than
 * trusted.
 *
 * Re-rounded to 7dp for the same reason: the columns are
 * `DecimalField(decimal_places=7)` and DRF refuses more digits than they hold.
 * The picker already rounds on the way in; this covers everything that did not
 * come from the picker.
 */
function coordinates(draft: Draft): { latitude: number | null; longitude: number | null } {
  const dp7 = (value: number) => Math.round(value * 1e7) / 1e7;
  if (draft.latitude === null || draft.longitude === null) {
    return { latitude: null, longitude: null };
  }
  return { latitude: dp7(draft.latitude), longitude: dp7(draft.longitude) };
}

export function toCreateInput(draft: Draft): CreateEventInput {
  return {
    organization_id: draft.organizationId,
    title: draft.title.trim(),
    description: draft.description,
    venue: draft.venue.trim(),
    city: draft.city.trim(),
    starts_at: toIso(draft.startsAt),
    ends_at: draft.endsAt ? toIso(draft.endsAt) : null,
    place_id: draft.placeId,
    ...coordinates(draft),
  };
}

/**
 * The PATCH body.
 *
 * Every content field is sent on every patch, including the empty ones — that
 * is what makes CLEARING a field work. Omitting blanks would mean an organizer
 * who deletes an age restriction sees it reappear on reload, because the
 * serializer treats a missing key as "leave it alone".
 *
 * The venue's place and pin follow the same rule and for the same reason:
 * removing a pin sends `place_id: ''`, `latitude: null`, `longitude: null`
 * together. Omitting them would leave the old pin on the event forever, with
 * the map on the public page still pointing at it.
 */
export function toPatchInput(draft: Draft): UpdateEventInput {
  return {
    version: draft.version,
    title: draft.title.trim(),
    description: draft.description,
    venue: draft.venue.trim(),
    city: draft.city.trim(),
    place_id: draft.placeId,
    ...coordinates(draft),
    starts_at: toIso(draft.startsAt),
    ...(draft.endsAt ? { ends_at: toIso(draft.endsAt) } : {}),
    short_description: draft.shortDescription.trim(),
    duration_minutes: draft.durationMinutes ? Number(draft.durationMinutes) : null,
    language: draft.language.trim(),
    age_restriction: draft.ageRestriction.trim(),
    accessibility_notes: draft.accessibilityNotes.trim(),
    seo_title: draft.seoTitle.trim(),
    seo_description: draft.seoDescription.trim(),
  };
}

/** Rupees in the field -> paise on the wire. Money is integer minor units
 *  everywhere in this API, and this is the one place the conversion happens. */
export function toTierInput(tier: DraftTier): CreateTicketTypeInput {
  return {
    name: tier.name.trim(),
    price: Math.round(Number(tier.price) * 100),
    quantity: Number(tier.quantity),
    max_per_order: Number(tier.maxPerOrder) || 10,
    sale_start: tier.saleStart ? toIso(tier.saleStart) : null,
    sale_end: tier.saleEnd ? toIso(tier.saleEnd) : null,
    // ARRAY ORDER IS THE POSITION, and the whole schedule is replaced on every
    // write — a phase has no server identity to preserve (see `DraftPhase`), so
    // there is nothing to diff and no per-phase patch to get wrong.
    //
    // Omitted entirely when there are no phases rather than sent as `[]`: an
    // absent key leaves an existing schedule alone, and a tier that never had
    // one must not send a payload implying its schedule was just cleared.
    ...(tier.phases.length ? { phases: tier.phases.map(toPhaseInput) } : {}),
  };
}

/** One phase, converted the way the tier's own price is: rupees to paise in
 *  MINOR units, blank bounds as explicit nulls. A blank `endsAt` and a blank
 *  `quantity` cannot both happen — `phaseIssues` refuses an unbounded phase
 *  before a save is ever attempted. */
function toPhaseInput(phase: DraftPhase): SalePhaseInput {
  return {
    name: phase.name.trim(),
    price: toMinor(phase.price),
    ends_at: phase.endsAt ? toIso(phase.endsAt) : null,
    quantity: phase.quantity === '' ? null : Number(phase.quantity),
  };
}

/** The fields that, when changed, need a PATCH. Compared as a string so a
 *  keystroke that lands back on the saved value does not queue a save. */
export function patchFingerprint(draft: Draft): string {
  return JSON.stringify([
    draft.title,
    draft.description,
    draft.venue,
    draft.city,
    // The pin is part of the PATCH, so it has to be part of the fingerprint —
    // without it, dragging the marker changes nothing the save engine can see
    // and the pin is never sent at all.
    draft.placeId,
    draft.latitude,
    draft.longitude,
    draft.startsAt,
    draft.endsAt,
    draft.shortDescription,
    draft.durationMinutes,
    draft.language,
    draft.ageRestriction,
    draft.accessibilityNotes,
    draft.seoTitle,
    draft.seoDescription,
  ]);
}

export function tierFingerprint(tier: DraftTier): string {
  return JSON.stringify([
    tier.name,
    tier.price,
    tier.quantity,
    tier.maxPerOrder,
    tier.saleStart,
    tier.saleEnd,
    // The schedule is part of the write, so it has to be part of the
    // fingerprint. Without it, editing a phase price changes nothing the save
    // engine can see — the discount is typed, the badge appears in the
    // preview, and the tier is never PATCHed. `key` is excluded: it is a React
    // list handle, and including it would make re-ordering identical phases
    // look like a change.
    tier.phases.map((phase) => [phase.name, phase.price, phase.endsAt, phase.quantity]),
  ]);
}

/* ─────────────────────────── live summary ─────────────────────────── */

export type PriceSummary = {
  lowestMinor: number | null;
  highestMinor: number | null;
  averageMinor: number | null;
  capacity: number;
  potentialMinor: number;
};

/**
 * The right panel's price summary.
 *
 * "Revenue potential" is gross — every ticket sold at its listed price. It is
 * labelled that way rather than as "revenue", because the platform fee comes
 * OUT of the total at settlement, and an organizer reading a projected payout
 * off a wizard would be reading the wrong number.
 */
export function priceSummary(tiers: DraftTier[]): PriceSummary {
  const priced = tiers
    .map((tier) => ({ price: Math.round(Number(tier.price) * 100), qty: Number(tier.quantity) }))
    .filter((tier) => Number.isFinite(tier.price) && tier.price >= 0 && Number.isFinite(tier.qty));

  if (priced.length === 0) {
    return {
      lowestMinor: null,
      highestMinor: null,
      averageMinor: null,
      capacity: 0,
      potentialMinor: 0,
    };
  }
  const prices = priced.map((tier) => tier.price);
  const capacity = priced.reduce((sum, tier) => sum + (tier.qty || 0), 0);
  const potentialMinor = priced.reduce((sum, tier) => sum + tier.price * (tier.qty || 0), 0);
  return {
    lowestMinor: Math.min(...prices),
    highestMinor: Math.max(...prices),
    // Quantity-weighted: the average price of a TICKET, not of a tier label.
    // Ten gold at ₹999 over nine hundred basic at ₹99 averages ~₹109; the
    // unweighted mean said ₹549, a number no attendee would ever pay. Null
    // until some tier has a quantity, because 0/0 is not an average.
    averageMinor: capacity > 0 ? Math.round(potentialMinor / capacity) : null,
    capacity,
    potentialMinor,
  };
}
