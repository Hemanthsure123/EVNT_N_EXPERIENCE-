import * as React from 'react';
import type { Metadata } from 'next';
import { OrganizerSignup } from '@/components/account/organizer-signup';

export const metadata: Metadata = { title: 'Host events' };

export default function AccountOrganizerPage() {
  return <OrganizerSignup />;
}
