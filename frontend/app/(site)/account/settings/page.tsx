import * as React from 'react';
import type { Metadata } from 'next';
import { AccountSettings } from '@/components/account/settings';

export const metadata: Metadata = { title: 'Settings' };

/**
 * `AccountSettings` reads `?section=` (and the Google callback's `?calendar=`)
 * from `useSearchParams`, which needs a Suspense boundary or the whole route
 * becomes client-rendered at request time — the same reason `/hire` wraps its
 * marketplace. The fallback is shaped like the page rather than a spinner (§13.1)
 * so nothing shifts when the real thing arrives.
 */
export default function AccountSettingsPage() {
  return (
    <React.Suspense fallback={<SettingsSkeleton />}>
      <AccountSettings />
    </React.Suspense>
  );
}

function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-block lg:gap-block-lg" aria-hidden>
      <div className="flex flex-col gap-stack">
        <div className="skeleton h-8 w-40 rounded-md" />
        <div className="skeleton h-5 w-64 rounded-md" />
      </div>
      <div className="grid gap-block lg:grid-cols-[11rem_minmax(0,1fr)] lg:items-start lg:gap-block-lg">
        <div className="hidden flex-col gap-1 lg:flex">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="skeleton h-control rounded-xl" />
          ))}
        </div>
        <div className="skeleton h-80 rounded-xl" />
      </div>
    </div>
  );
}
