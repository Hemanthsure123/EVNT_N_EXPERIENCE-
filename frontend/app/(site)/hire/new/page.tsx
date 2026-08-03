import * as React from 'react';
import type { Metadata } from 'next';
import { Container } from '@/components/shell/container';
import { BriefForm } from '@/components/hire/brief-form';
import { pageMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = {
  ...pageMetadata(
    'Request quotes from performers',
    'Tell us what you need, where and when. Every act that fits answers with a real quote.',
  ),
  robots: { index: false, follow: true },
};

/**
 * `BriefForm` owns the `h1` and the illustration, not this page — it reads
 * `useSearchParams` and therefore has to sit behind the Suspense boundary
 * anyway, and a heading rendered here would be a second source of truth for
 * the copy on a screen that already has one.
 */
export default function NewBriefPage() {
  return (
    <Container className="py-8 lg:py-16">
      <React.Suspense fallback={<div className="skeleton h-96 w-full rounded-2xl" aria-hidden />}>
        <BriefForm />
      </React.Suspense>
    </Container>
  );
}
