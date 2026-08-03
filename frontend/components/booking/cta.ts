/**
 * The funnel's action language, in ONE place.
 *
 * ── WHY THESE ARE STRINGS AND NOT A BUTTON VARIANT ────────────────────────
 *
 * The light-first language makes the primary action a NEAR-BLACK PILL — `--cta`
 * fill, `--cta-foreground` label, fully rounded, generous horizontal padding —
 * inverting to a near-white pill with dark ink in dark theme. That is a token
 * pair (`bg-cta`), deliberately NOT `--primary`, which stayed violet and is now
 * the wayfinding accent (see the decision note at the top of styles/tokens.css).
 *
 * `components/ui/button.tsx` still fills with `bg-primary` and rounds to
 * `rounded-md`, and it is shared with the admin console, the organizer
 * dashboard, the studio and the auth panel — repointing it is a design-system
 * change, not a checkout one. So the funnel applies the pill through
 * `className`, which `cn()`'s tailwind-merge resolves against the variant's own
 * classes (same group, later wins). When the shared Button does move to `--cta`,
 * every one of these becomes a redundant no-op rather than a conflict, and they
 * can be deleted in one pass.
 *
 * ── THE RULE THESE ENCODE ─────────────────────────────────────────────────
 *
 * ONE black pill per screen. Every other control on the funnel — Change, View
 * event, Directions, Back to the event — is an outline or ghost PILL: same
 * shape, no fill, so shape says "control" and fill says "this is the one".
 * `h-control` (44px) is the touch-target floor and is why the mobile bar's
 * button and the desktop button are the same height.
 */

/** The primary action. Near-black in light, near-white in dark. */
export const CTA_PILL =
  'rounded-full bg-cta text-cta-foreground shadow-sm hover:bg-cta-hover active:bg-cta-active';

/** The primary action at hero size — the one press that advances the funnel. */
export const CTA_PILL_LG = `${CTA_PILL} h-control-lg px-pill-lg`;

/** A secondary control: pill-shaped, unfilled. Pairs with variant="outline". */
export const PILL = 'rounded-full px-pill';

/** A secondary control at the standard control height. */
export const PILL_MD = `${PILL} h-control`;
