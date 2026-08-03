import * as React from 'react';
import type { Metadata } from 'next';
import { Analytics } from '@/components/organizer/analytics';

export const metadata: Metadata = { title: 'Analytics' };

export default function OrganizerAnalyticsPage() {
  return <Analytics />;
}
