import * as React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Container } from '@/components/shell/container';
import { MyRequests } from '@/components/hire/my-requests';

export const metadata: Metadata = {
  title: 'Your briefs',
  robots: { index: false, follow: false },
};

export default function MyRequestsPage() {
  return (
    <Container className="flex flex-col gap-6 py-8 sm:gap-8 lg:py-14">
      <header className="flex flex-wrap items-end justify-between gap-3 sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-h3 sm:text-h2">Your briefs</h1>
          <p className="mt-1 text-body-sm text-muted-foreground">
            Every brief you have posted, and the quotes on it.
          </p>
        </div>
        <Link
          href="/hire/new"
          className="inline-flex h-control items-center rounded-full bg-cta px-pill text-label text-cta-foreground transition-colors hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Post a brief
        </Link>
      </header>
      <MyRequests />
    </Container>
  );
}
