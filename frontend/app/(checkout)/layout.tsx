import * as React from 'react';

/**
 * The checkout's own shell — which is to say, almost none.
 *
 * ── WHY THE FUNNEL LEFT `(site)` ──────────────────────────────────────────
 *
 * These two screens used to live inside the public discovery layout, so a
 * checkout inherited the whole site: an announcement bar, the logo row, a city
 * switcher, a search field, a theme toggle, an account avatar, the bottom tab
 * bar, a "Find something on this week" marketing panel and the full footer with
 * its four columns of links.
 *
 * Measured on a phone, that put roughly a screen of chrome above the first
 * ticket tier — you could not see a single thing you were there to buy without
 * scrolling — and it ended the review screen, where a hold is counting down and
 * a payment is one press away, with an invitation to go and browse something
 * else. Every one of those controls is a way out of a flow whose entire job is
 * to finish.
 *
 * A route group changes no URL. `/booking/{id}` and `/booking/{id}/review` are
 * exactly where they were; they simply stopped being pages inside a website and
 * became a checkout.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────
 *
 * No `loading.tsx`. `(site)` has one, and a Suspense boundary makes Next flush
 * the shell before the page resolves — which turns a page-level `redirect()`
 * into a CLIENT-side navigation encoded in the RSC stream rather than a real
 * 3xx. The retired `/pay` and `/login` routes are `redirect()` shims, so they
 * need to answer with an actual status code.
 *
 * No cookie banner: it is `fixed` to the bottom of the viewport, which is
 * precisely where the pay bar lives. It covered the Continue button once
 * already; it has no business on a payment screen at all.
 *
 * Theme, React Query, auth, toasts and tooltips all come from the ROOT layout,
 * so nothing is lost by stepping out of `(site)` — this group needs no
 * providers of its own.
 */
export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        href="#funnel-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-tooltip focus:rounded-full focus:bg-cta focus:px-pill focus:py-2.5 focus:text-label focus:text-cta-foreground focus:shadow-lg"
      >
        Skip to content
      </a>
      {children}
    </>
  );
}
