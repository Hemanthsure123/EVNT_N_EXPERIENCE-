import {
  Cpu,
  Disc3,
  Mic,
  Music,
  Palette,
  Sparkles,
  Tent,
  Trophy,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';

/**
 * Resolve a CMS-authored icon NAME to a bundled component.
 *
 * ── WHY A NAME, AND WHY AN ALLOW-LIST ─────────────────────────────────────
 *
 * `Category.icon` is a string an operator types in the CMS. It is deliberately
 * not a URL: an arbitrary remote image on the busiest page on the platform is
 * an unvalidated third-party request in front of the LCP, and an operator
 * account is exactly the account an attacker would want for that.
 *
 * A name resolved against this map is safe by construction — the worst an
 * operator can do is type something unrecognised, which falls back to a
 * neutral glyph rather than breaking the row.
 *
 * ── WHY NOT DYNAMIC IMPORT ────────────────────────────────────────────────
 *
 * Importing all of lucide by name would pull the entire icon set into the
 * homepage bundle. Nine icons, listed, is the whole taxonomy today; adding one
 * is a one-line change here and a deploy — which is the honest trade for
 * keeping the front page small.
 */
const ICONS: Record<string, LucideIcon> = {
  Music,
  Mic,
  Palette,
  Trophy,
  Tent,
  Disc3,
  UtensilsCrossed,
  Cpu,
};

/** The fallback is deliberate: an unknown name renders a real tile, not a hole. */
export function categoryIcon(name: string): LucideIcon {
  return ICONS[name] ?? Sparkles;
}

/**
 * The gradient a tile uses, derived from its position rather than stored.
 *
 * The brief asked for an admin-controlled accent colour per category. There is
 * no colour column, and adding one would let an operator put an arbitrary hue
 * on the front page — which §4.4 forbids: colour here is decorative rhythm,
 * not meaning, and a taxonomy where every tile is a different invented hue is
 * exactly the "component-per-colour" habit the design system rejects.
 *
 * Cycling four brand-scale gradients keeps the row rhythmic, on-brand, and
 * impossible to get wrong. BACKLOG item 41 covers the column if editorial
 * genuinely needs it.
 */
const TONES = [
  'from-violet-600 to-pink-500',
  'from-info to-violet-600',
  'from-success to-info',
  'from-pink-600 to-warning',
] as const;

export function categoryTone(index: number): string {
  return TONES[index % TONES.length];
}
