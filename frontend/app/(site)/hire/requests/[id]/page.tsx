import * as React from 'react';
import type { Metadata } from 'next';
import { Container } from '@/components/shell/container';
import { RequestDetail } from '@/components/hire/request-detail';

export const metadata: Metadata = {
  title: 'Your brief',
  // Per-customer and not public. Never indexed.
  robots: { index: false, follow: false },
};

export default function RequestPage({ params }: { params: { id: string } }) {
  return (
    <Container className="py-8 lg:py-14">
      <RequestDetail requestId={params.id} />
    </Container>
  );
}
