'use client';

import * as React from 'react';
import { CalendarDays, Home, Heart, Music4 } from 'lucide-react';
import { BottomNav } from './bottom-nav';

/**
 * Mobile bottom navigation. Search lives in the sticky header, so it is not
 * duplicated here — these are destinations, not actions. Four is the ceiling:
 * a fifth makes each target too narrow to hit reliably at thumb width.
 *
 * The bar is `position: fixed`, so it covers whatever is under it. Clearing it
 * is the LAYOUT's job, not this component's — `app/(site)/layout.tsx` pads both
 * `<main>` and the footer, and `BOTTOM_NAV_CLEARANCE` in `bottom-nav.tsx` is
 * the single class that expresses the amount. Anything that pins itself above
 * the bar instead of scrolling under it uses `bottom-bottom-nav` (the event
 * page's booking bar, the funnel's action bar) so that the offset is the same
 * token and not a second copy of the number.
 */
export function SiteBottomNav() {
  return (
    <BottomNav
      items={[
        { href: '/', label: 'Home', icon: <Home className="size-5" /> },
        { href: '/events', label: 'Events', icon: <CalendarDays className="size-5" /> },
        // `/account/saved`, NOT `/saved`. This replaced the deleted Cities tab
        // and was written from memory: `/saved` has never existed, so the
        // mobile Saved tab 404'd from the moment it shipped. The bottom nav is
        // the ONLY route to saved events on a phone, so it took the whole
        // feature with it.
        { href: '/account/saved', label: 'Saved', icon: <Heart className="size-5" /> },
        { href: '/hire', label: 'Hire', icon: <Music4 className="size-5" /> },
      ]}
    />
  );
}
