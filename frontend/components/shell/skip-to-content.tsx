'use client';

import * as React from 'react';
import { useEventDeck } from '@/lib/discovery/event-deck-context';

/**
 * The keyboard user's shortcut past the header — and nothing else's.
 *
 * ── THE BUG: A BLACK PILL SITTING ON THE LOGO ─────────────────────────────
 *
 * Reported as "permanently visible, overlapping the top-left of the UI" on the
 * event page, and measured on the deployed site: one `Tab` puts this link at
 * `fixed` 16,16 at 138×36, and the brand lockup is at 16,14 at 62×36. It
 * covers the logo exactly. That is what the screenshot showed.
 *
 * Two separate defects produced it, and both are fixed here.
 *
 * **1. `:focus` is not "keyboard".** The old class was `focus:not-sr-only`.
 * `:focus` matches a POINTER press and a programmatic `.focus()` as well as a
 * Tab, and on mobile browsers focus SURVIVES the tap that set it — so once
 * anything focused this link it stayed drawn until something else took focus.
 * `:focus-visible` is the selector that means what the accessibility pattern
 * has always intended: reveal on keyboard navigation, stay hidden for a touch
 * or a mouse. Every variant here moved, not just `not-sr-only` — leaving a
 * `focus:` fallback beside it would re-admit the exact case being removed.
 *
 * **2. It offered a shortcut INTO a page that is covered.** On a phone the
 * event route renders the deck, a fixed `aria-modal` overlay over the whole
 * document. `#main` is underneath it, so the link was a dead end drawn on top
 * of a dialog — and a modal is precisely where content outside it should be
 * unreachable. While the deck is open this renders nothing at all.
 *
 * **3. Activating it did not move focus, so the pill never went away.** This
 * is what made it "permanent" rather than momentary, and it is the defect that
 * `:focus-visible` alone does not reach. A bare `href="#main"` SCROLLS: the
 * landmark is not focusable, so nothing takes focus off the anchor, and the
 * App Router does not reset focus on a soft navigation either. So the pill
 * survived the press AND every route change after it — and because it is drawn
 * at 16,16 at 138×36 it covers the brand lockup at 16,14 at 62×36 exactly, so
 * the next tap aimed at the logo hit the skip link again and renewed the whole
 * thing. A loop that feeds itself, which is why it reads as permanent.
 *
 * `jump` moves focus to the landmark, which is what a skip link is FOR — the
 * point is that the next Tab continues from the content rather than from the
 * header you just skipped. Scrolling was only ever the visible half of it.
 *
 * `useEventDeck` has a safe default (`isOpen: false`) outside its provider, so
 * the checkout group — which has no deck — gets the plain link with no
 * provider and no special case.
 */
export function SkipToContent({
  /** The landmark to jump to. `(site)` uses `main`; the funnel `funnel-main`. */
  targetId,
}: {
  targetId: string;
}) {
  const { isOpen } = useEventDeck();

  /**
   * Land focus ON the content, not merely the viewport over it.
   *
   * `tabindex="-1"` makes a landmark programmatically focusable WITHOUT
   * putting it in the tab order — the standard move, and it has to be set
   * here rather than in the layouts because this component owns the contract
   * and two layouts setting it is two places to forget it.
   *
   * The default hash navigation is left alone (it does the scrolling, and a
   * `#main` URL is what a skip link has always produced). All this adds is
   * the focus, which is the half that was missing.
   */
  const jump = () => {
    const target = document.getElementById(targetId);
    if (!target) return;
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  };

  // Removed from the DOM rather than hidden: a `sr-only` link is still in the
  // tab order and still announced, and both are wrong while a dialog owns the
  // screen.
  if (isOpen) return null;

  return (
    <a
      href={`#${targetId}`}
      onClick={jump}
      className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-tooltip focus-visible:rounded-full focus-visible:bg-cta focus-visible:px-pill focus-visible:py-2.5 focus-visible:text-label focus-visible:text-cta-foreground focus-visible:shadow-lg"
    >
      Skip to content
    </a>
  );
}
