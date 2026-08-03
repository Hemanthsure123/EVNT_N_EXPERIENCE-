/**
 * The eight discovery categories.
 *
 * IMPORTANT — the interim mapping: the backend `Event` model has NO category
 * column (see backend/apps/events/models.py). Until it does, a category is
 * expressed as a single stemmed term pushed through the existing full-text
 * search (`GET /events?q=`), which Postgres already indexes over title (A),
 * venue/city (B) and description (C).
 *
 * ONE term, not a phrase, on purpose: `websearch` tsquery ANDs its terms, so a
 * multi-word category query would also have to match a user's own words and
 * would return nothing. A single stem combines cleanly with a user query.
 *
 * `match` powers the card's category chip (best-effort inference from the
 * title/venue). Both go away the moment the backend gains a real `category`
 * field — see frontend/BACKLOG.md, item 2.
 */

import {
  Cpu,
  Disc3,
  Mic,
  Music,
  Palette,
  Tent,
  Trophy,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';

export type CategorySlug =
  | 'concerts'
  | 'comedy'
  | 'workshops'
  | 'sports'
  | 'festivals'
  | 'nightlife'
  | 'food-drink'
  | 'tech';

export type Category = {
  slug: CategorySlug;
  label: string;
  /** What actually goes to `GET /events?q=` (see the note above). */
  query: string;
  /** Lower-case needles used to infer the chip on a card. */
  match: string[];
  icon: LucideIcon;
  /** Token-only gradient for the tile medallion. */
  tone: string;
  blurb: string;
};

export const CATEGORIES: Category[] = [
  {
    slug: 'concerts',
    label: 'Concerts',
    query: 'concert',
    match: ['concert', 'live', 'tour', 'unplugged', 'symphony', 'arena', 'gig'],
    icon: Music,
    tone: 'from-violet-600 to-pink-500',
    blurb: 'Arenas, amphitheatres and intimate gigs',
  },
  {
    slug: 'comedy',
    label: 'Comedy',
    query: 'comedy',
    match: ['comedy', 'stand-up', 'standup', 'improv', 'open mic', 'laugh'],
    icon: Mic,
    tone: 'from-pink-500 to-warning',
    blurb: 'Stand-up, improv and open mics',
  },
  {
    slug: 'workshops',
    label: 'Workshops',
    query: 'workshop',
    match: ['workshop', 'masterclass', 'class', 'intensive', 'bootcamp', 'session'],
    icon: Palette,
    tone: 'from-info to-violet-600',
    blurb: 'Learn something with your hands',
  },
  {
    slug: 'sports',
    label: 'Sports',
    query: 'sports',
    match: ['sports', 'match', 'league', 'marathon', 'championship', 'kabaddi', 'football'],
    icon: Trophy,
    tone: 'from-success to-info',
    blurb: 'Matches, leagues and race days',
  },
  {
    slug: 'festivals',
    label: 'Festivals',
    query: 'festival',
    match: ['festival', 'utsav', 'carnival', 'fest', 'lollapalooza'],
    icon: Tent,
    tone: 'from-pink-600 to-warning',
    blurb: 'Multi-day line-ups and culture fests',
  },
  {
    slug: 'nightlife',
    label: 'Nightlife',
    query: 'nightlife',
    match: ['nightlife', 'techno', 'house', 'dj', 'rave', 'sundowner', 'afterhours', 'night'],
    icon: Disc3,
    tone: 'from-violet-900 to-pink-600',
    blurb: 'Club nights, rooftops and afterhours',
  },
  {
    slug: 'food-drink',
    label: 'Food & Drink',
    query: 'food',
    match: ['food', 'wine', 'tasting', 'brunch', 'beer', 'coffee', 'kitchen', 'chef'],
    icon: UtensilsCrossed,
    tone: 'from-warning to-destructive',
    blurb: 'Tastings, pop-ups and chef tables',
  },
  {
    slug: 'tech',
    label: 'Tech',
    query: 'tech',
    match: ['tech', 'conference', 'summit', 'meetup', 'hackathon', 'startup', 'devfest'],
    icon: Cpu,
    tone: 'from-slate-900 to-violet-700',
    blurb: 'Conferences, meetups and demo nights',
  },
];

const BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));

export function categoryBySlug(slug: string | null | undefined): Category | null {
  if (!slug) return null;
  return BY_SLUG.get(slug as CategorySlug) ?? null;
}

export function isCategorySlug(value: string | null | undefined): value is CategorySlug {
  return !!value && BY_SLUG.has(value as CategorySlug);
}

/**
 * Best-effort category for an event, from its title + venue. Returns null when
 * nothing matches — a wrong chip is worse than no chip. Replace with the real
 * `event.category` as soon as the backend has one.
 */
export function inferCategory(event: { title: string; venue?: string }): Category | null {
  const haystack = `${event.title} ${event.venue ?? ''}`.toLowerCase();
  for (const category of CATEGORIES) {
    if (category.match.some((needle) => haystack.includes(needle))) return category;
  }
  return null;
}
