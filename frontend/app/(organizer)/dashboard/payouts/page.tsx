import * as React from 'react';
import type { Metadata } from 'next';
import { Payouts } from '@/components/organizer/payouts';

export const metadata: Metadata = { title: 'Payouts' };

export default function OrganizerPayoutsPage() {
  return <Payouts />;
}
