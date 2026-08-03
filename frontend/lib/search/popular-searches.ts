/**
 * Popular searches.
 *
 * ADMIN-MANAGED as of `cms.PopularSearch` — an operator curates these and they
 * ride on the homepage payload, which the panel already has. "Popular" here
 * means "what we want to point people at", not a measurement: the platform has
 * no search-term log, and a number invented from nothing is what this codebase
 * refuses to show elsewhere. When a query log exists this becomes a fallback
 * and the shape does not move.
 *
 * The constant below is the LAST-RESORT list, used only when the payload has
 * not arrived (the panel opens on a page that never fetched the homepage, or
 * the request failed). Every entry returns real results rather than a
 * plausible-looking dead end.
 */

import { browseHref } from '@/lib/discovery/filters';

export type PopularSearch = {
  label: string;
  href: string;
};

export const POPULAR_SEARCHES: PopularSearch[] = [
  { label: 'Comedy this weekend', href: browseHref({ category: 'comedy', when: 'weekend' }) },
  { label: 'Concerts in Mumbai', href: browseHref({ category: 'concerts', city: 'Mumbai' }) },
  { label: 'Free events near you', href: browseHref({ price: 'free' }) },
  {
    label: 'Workshops in Bengaluru',
    href: browseHref({ category: 'workshops', city: 'Bengaluru' }),
  },
  { label: 'Festivals in Goa', href: browseHref({ category: 'festivals', city: 'Goa' }) },
  { label: 'Tech meetups', href: browseHref({ category: 'tech' }) },
];
