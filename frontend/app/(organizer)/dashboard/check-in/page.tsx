import * as React from 'react';
import type { Metadata } from 'next';
import { CheckIn } from '@/components/organizer/check-in';

export const metadata: Metadata = { title: 'Check-in' };

export default function OrganizerCheckInPage() {
  return <CheckIn />;
}
