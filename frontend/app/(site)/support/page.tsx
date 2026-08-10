import * as React from 'react';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { SupportCentre } from '@/components/support/support-centre';
import { PageHeader, StaticPage } from '@/components/pages/page-shell';
import { pageMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = {
  ...pageMetadata(
    'Support',
    'Raise a query about a booking, a ticket or your account, and read the replies.',
  ),
  alternates: { canonical: '/support' },
  // Per-account content behind a session. Nothing here is worth indexing and
  // the page is empty to a crawler.
  robots: { index: false, follow: true },
};

export default function SupportPage() {
  return (
    <StaticPage>
      <PageHeader
        eyebrow="Support"
        title="Get help"
        lead="Ask the organiser or our team. Replies land here and in your email."
      />
      {/* `useSearchParams` (the `?ticket=` deep link) needs a Suspense boundary
          or the whole route opts out of static rendering. */}
      <Suspense fallback={null}>
        <SupportCentre />
      </Suspense>
    </StaticPage>
  );
}
