import * as React from 'react';
import { BrandMark } from '@/components/shell/brand-mark';

/**
 * The mobile event page's own branding, pinned to the top of the page.
 *
 * The deck is opened from a feed, from a shared link and from an in-app
 * webview, and in the last two there is no site chrome anywhere on the screen —
 * nothing says whose product this is. This is that, and it is deliberately the
 * cheapest possible version: a mark, a word, and no controls.
 *
 * STICKY, INSIDE THE PAGE'S OWN SCROLLER. `position: sticky` pins it against
 * the scroll box it lives in, which is the page — the deck is a fixed overlay
 * over a scroll-locked document, so the window never moves and a header
 * waiting on the window would never pin. It cannot be `fixed` either: that
 * would take it out of the page and put it over the dialog's scrim instead.
 *
 * The background is SOLID (`bg-background`), because the hero and every
 * section after it now pass underneath; a transparent header over a moving
 * photograph is two things fighting for the same pixels. `z-50` puts it above
 * the floating booking bar (`z-30`) and everything in the flow.
 *
 * ── ITS OWN FILE, AND NOT A CLIENT COMPONENT ─────────────────────────────
 *
 * Two things draw it: the deck, and `DeckShell`, the server-rendered cover a
 * shared link shows before the deck has hydrated. The cover imports its
 * geometry rather than copying it so the handover cannot move, and this row is
 * part of that geometry — the cover drew no header at all, so every arrival
 * shifted the poster down by this row's height at the one instant the swap is
 * meant to be invisible.
 *
 * The mark is `BrandMark` — the one definition of it in the codebase, so a
 * brand change lands here without anybody remembering this file exists.
 */
export function DeckBrandHeader() {
  return (
    <div className="sticky top-0 z-50 flex items-center justify-center bg-background px-4 pb-2 pt-3">
      <span className="absolute left-4 top-1/2 inline-flex -translate-y-1/2">
        <BrandMark title="Curatix" className="h-6 w-auto" />
      </span>
      {/* Absolutely centred against the SCREEN, not against the space left
          over beside the mark — a flex-centred word shifts right by half the
          logo's width, which is visible the moment anything else joins the
          row. */}
      <span className="text-body font-extrabold tracking-tight text-foreground">Curatix</span>
    </div>
  );
}
