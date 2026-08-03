import * as React from 'react';
import type { Metadata } from 'next';
import { MyTickets } from '@/components/account/tickets';

export const metadata: Metadata = { title: 'Tickets' };

export default function AccountTicketsPage() {
  return <MyTickets />;
}
