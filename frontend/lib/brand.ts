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
