import type { CategorySlug } from '@/lib/discovery/categories';

/**
 * A category's PASTEL TINT — the light-first replacement for the saturated
 * violet/pink `tone` gradients.
 *
 * ── WHY A SECOND MAPPING AND NOT A CHANGE TO `tone` ───────────────────────
 *
 * `tone` (lib/discovery/categories.ts) is still the right answer in the ONE
 * place a gradient is allowed to survive: standing in for a photograph that
 * does not exist, with white text composited on top of it (the hero slide).
 * A pastel there would make `on-gradient` text unreadable.
 *
 * Everywhere the artwork is *beside* or *above* its label rather than under
 * it — the category tile, a poster-less card, a rail thumbnail — the target
 * language wants "a soft pastel tint matching that category's hue" with the
 * clay icon sitting on it. That is a different job, so it is a different
 * mapping, and both keep working.
 *
 * ── KEYED BY SLUG, LIKE `ClayIcon` ────────────────────────────────────────
 *
 * The live tiles come from `GET /homepage`, whose payload has NO `tone` field
 * — only a slug. Keying off the slug is therefore the only lookup that works
 * for both the CMS path and the bundled `CATEGORIES` lifeboat, and it is the
 * same key that already picks the clay artwork, so the icon and the tint
 * behind it can never disagree.
 *
 * ── THE CLASS NAMES ARE LITERAL, ON PURPOSE ───────────────────────────────
 *
 * Tailwind scans source TEXT: `bg-tint-${slug}` produces a class that was
 * never generated. Every pair is written out. The tokens themselves
 * (`--tint-<slug>` / `--tint-<slug>-ink`) flip with the theme and were
 * contrast-checked against each other AND against the canvas, so a label can
 * sit on the tint or beside it and stay legible either way.
 */
export type CategoryTint = {
  /** Background utility for the tinted plate. */
  surface: string;
  /** The deep partner ink — legible on `surface` and on the page canvas. */
  ink: string;
};

const TINTS: Record<CategorySlug, CategoryTint> = {
  concerts: { surface: 'bg-tint-concerts', ink: 'text-tint-concerts-ink' },
  comedy: { surface: 'bg-tint-comedy', ink: 'text-tint-comedy-ink' },
  workshops: { surface: 'bg-tint-workshops', ink: 'text-tint-workshops-ink' },
  sports: { surface: 'bg-tint-sports', ink: 'text-tint-sports-ink' },
  festivals: { surface: 'bg-tint-festivals', ink: 'text-tint-festivals-ink' },
  nightlife: { surface: 'bg-tint-nightlife', ink: 'text-tint-nightlife-ink' },
  'food-drink': { surface: 'bg-tint-food-drink', ink: 'text-tint-food-drink-ink' },
  tech: { surface: 'bg-tint-tech', ink: 'text-tint-tech-ink' },
};

/**
 * A warm neutral for an unrecognised slug. Never a hole and never a guess at
 * somebody else's hue — the same rule `ClaySparkle` follows for a category
 * nobody mapped.
 */
const NEUTRAL: CategoryTint = { surface: 'bg-muted', ink: 'text-muted-foreground' };

export function categoryTint(slug: string | null | undefined): CategoryTint {
  if (!slug) return NEUTRAL;
  return TINTS[slug as CategorySlug] ?? NEUTRAL;
}
