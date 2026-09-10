import * as React from 'react';
import Link from 'next/link';
import { BrandLockup } from '@/components/shell/brand-mark';
import { BRAND_NAME } from '@/lib/brand';

/**
 * The mobile event page's header — the SAME shape as the home page's.
 *
 * Top-left is the full lockup (mark + "curatix"), exactly as the site header
 * draws it, and it is a link HOME. Top-right is the account avatar and nothing
 * else. It used to be a lone mark on the left and the word "Curatix" centred:
 * a different header from every other screen, and one that could not take you
 * anywhere.
 *
 * STICKY, INSIDE THE PAGE'S OWN SCROLLER. `position: sticky` pins it against
 * the scroll box it lives in, which is the page — the deck is a fixed overlay
 * over a scroll-locked document, so a header waiting on the window would never
 * pin, and `fixed` would put it over the dialog's scrim instead. The
 * background is SOLID because the poster and everything after it pass
 * underneath. `z-50` puts it above the floating booking bar (`z-30`).
 *
 * ── ITS OWN FILE, AND NOT A CLIENT COMPONENT ─────────────────────────────
 *
 * Two things draw it: the deck, and `DeckShell`, the server-rendered cover a
 * shared link shows before the deck has hydrated. The cover passes no
 * `account` and gets a placeholder circle of the avatar's exact size, so the
 * handover moves nothing. The account control itself is a client component
 * (`DeckAccount`) the deck hands in.
 */
export function DeckBrandHeader({
  account,
  onHome,
}: {
  /** The avatar control. Absent on the server cover, which draws its footprint. */
  account?: React.ReactNode;
  /**
   * Called as the logo is pressed, before the navigation. The deck is an
   * overlay, and going HOME from it has to close it — including when home is
   * where it was opened, where the URL does not change at all.
   */
  onHome?: () => void;
}) {
  return (
    <div className="sticky top-0 z-50 flex items-center justify-between gap-3 bg-background px-4 py-2">
      <Link
        href="/"
        onClick={onHome}
        aria-label={`${BRAND_NAME} — home`}
        className="group inline-flex shrink-0 items-center rounded-full py-1 pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <BrandLockup className="transition-opacity duration-fast ease-out group-hover:opacity-80" />
      </Link>
      {account ?? <span aria-hidden className="size-control shrink-0 rounded-full bg-muted" />}
    </div>
  );
}
