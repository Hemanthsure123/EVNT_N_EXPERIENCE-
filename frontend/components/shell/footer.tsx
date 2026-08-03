/**
 * `Footer` IS `SiteFooter`. There is one footer.
 *
 * ── WHY THIS FILE IS THREE LINES ──────────────────────────────────────────
 *
 * It used to hold a second, near-identical footer: same tinted band, same brand
 * lockup, same copyright — and a DIFFERENT set of links. It had a "Discover"
 * group the live footer never showed, no Support group, no payment methods and
 * two social icons where the live one has four. Nothing rendered it except
 * `/style-guide`.
 *
 * That is worse than dead code. `/style-guide` is the page the axe sweep scans
 * in both themes (`tests/e2e/style-guide.spec.ts`), so the accessibility check
 * was auditing a footer no visitor could reach while the real one — on every
 * public page — went unscanned. Two implementations of one component always
 * drift; this pair had already drifted, and the drift was invisible precisely
 * because each half looked fine on its own.
 *
 * The two link sets were merged rather than one being discarded: the Discover
 * group lives in `site-footer.tsx` now, so consolidating cost no links.
 *
 * The re-export is kept so `app/style-guide/page.tsx` and the `shell` barrel
 * keep compiling. Once they import `SiteFooter` directly this file can go — see
 * `needs_from_others`.
 */
export { SiteFooter as Footer } from './site-footer';
