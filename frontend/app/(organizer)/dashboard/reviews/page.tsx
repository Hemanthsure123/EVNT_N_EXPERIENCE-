import * as React from 'react';
import type { Metadata } from 'next';
import { Reviews } from '@/components/organizer/reviews';

export const metadata: Metadata = { title: 'Reviews' };

export default function OrganizerReviewsPage() {
  return <Reviews />;
}
