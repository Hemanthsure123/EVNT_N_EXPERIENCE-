import * as React from 'react';
import { LeadsInbox } from '@/components/performer/leads';

export const metadata = { title: 'Leads' };

export default function LeadsPage({ params }: { params: { id: string } }) {
  return <LeadsInbox performerId={params.id} />;
}
