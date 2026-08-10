/**
 * The product's name, in one place.
 *
 * It was spelled out as a literal in 26 files, which is why renaming it was a
 * sweep rather than an edit — and why a sweep always misses one. Anything
 * user-facing should import from here.
 *
 * `LEGAL_NAME` is deliberately separate: a footer, an invoice and a refund
 * email are about a company, and the two diverge the moment one is registered.
 */
export const BRAND_NAME = 'Curatix';
export const LEGAL_NAME = 'Curatix';

/** Used in `<title>` suffixes and OpenGraph `site_name`. */
export const SITE_NAME = BRAND_NAME;

/**
 * ── CONTACT AND SOCIAL: CONFIGURED, NEVER ASSUMED ─────────────────────────
 *
 * The footer used to link four social icons at `https://instagram.com`,
 * `https://x.com`, `https://facebook.com` and `https://youtube.com` — the
 * platforms' own front doors, not accounts. A visitor who clicked one landed on
 * Instagram's login wall, which reads as a broken product rather than as an
 * absent one.
 *
 * That is the same failure the rest of this codebase refuses everywhere else: a
 * control that appears to work and does not. So the handles are env-driven and
 * **an unset one renders nothing at all** — the row shrinks to the accounts
 * that exist, and disappears entirely when none do. Turning one on is a
 * deploy-time value, not a code change.
 *
 * Support email/phone follow the same rule: `/contact` names only the channels
 * that are actually configured, and says plainly which are not yet open rather
 * than printing an address nobody reads.
 */
export const SOCIAL_HANDLES = {
  instagram: process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM ?? '',
  x: process.env.NEXT_PUBLIC_SOCIAL_X ?? '',
  facebook: process.env.NEXT_PUBLIC_SOCIAL_FACEBOOK ?? '',
  youtube: process.env.NEXT_PUBLIC_SOCIAL_YOUTUBE ?? '',
  linkedin: process.env.NEXT_PUBLIC_SOCIAL_LINKEDIN ?? '',
} as const;

/** Support channels. Empty string === not open; the UI says so rather than inventing one. */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? '';
export const SUPPORT_PHONE = process.env.NEXT_PUBLIC_SUPPORT_PHONE ?? '';

/**
 * The registered address, for the legal pages and the tax invoice. Absent until
 * the company is registered — the pages render a "being registered" line rather
 * than a plausible-looking address, because a fake address on a Terms page is
 * the kind of detail that voids the document it appears on.
 */
export const REGISTERED_ADDRESS = process.env.NEXT_PUBLIC_REGISTERED_ADDRESS ?? '';
export const GSTIN = process.env.NEXT_PUBLIC_GSTIN ?? '';

// The platform fee is NOT here. It is a flat per-ticket amount in paise and
// already lives in `lib/booking/selection.ts` as `PLATFORM_FEE_PER_TICKET`,
// mirroring the backend's setting of the same name. /pricing imports that one
// — a second copy is how the pricing page and the checkout end up quoting
// different numbers for the same fee.
