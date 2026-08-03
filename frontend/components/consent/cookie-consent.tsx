'use client';

import * as React from 'react';
import Link from 'next/link';
import { Cookie } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCookieConsent } from '@/lib/consent/use-cookie-consent';

/**
 * Cookie/storage consent.
 *
 * Rendered fixed to the bottom and only AFTER the stored preference has been
 * read, so it never flashes for someone who already answered. Both choices are
 * equally weighted buttons — declining is one tap, same as accepting.
 *
 * It sits above the mobile bottom nav rather than covering it, and it's a
 * `role="dialog"` with a label so a screen reader announces it as the thing it
 * is without stealing focus mid-scroll.
 */
export function CookieConsent() {
  const { preference, ready, accept } = useCookieConsent();

  if (!ready || preference) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie preferences"
      className="fixed inset-x-0 bottom-16 z-drawer px-4 pb-4 md:bottom-0"
    >
      <div className="mx-auto flex max-w-container flex-col gap-4 rounded-xl border border-border bg-elevated p-4 shadow-xl sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
            <Cookie className="size-4" aria-hidden />
          </span>
          {/*
            `max-w-prose` is a performance fix as much as a typographic one. This
            banner renders only after hydration, and full-width it was a ~34,000px²
            block of text — larger than the real content on any page without a big
            image, so it became the Largest Contentful Paint at whatever moment
            hydration finished. Measured at 5.1s on a throttled profile, against
            real content that had painted at 2.0s. Chrome furniture should not be
            the largest thing on the page, and a 90-character measure was never
            good for reading either.
          */}
          <p className="max-w-prose text-body-sm text-muted-foreground">
            We use essential storage to keep your theme, city and recent searches on this device.
            Accept optional cookies to help us measure what&apos;s working.{' '}
            <Link
              href="/cookies"
              className="rounded-sm text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cookie policy
            </Link>
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => accept('essential')}>
            Essential only
          </Button>
          <Button size="sm" onClick={() => accept('all')}>
            Accept all
          </Button>
        </div>
      </div>
    </div>
  );
}
