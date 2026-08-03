import * as React from 'react';
import type { Metadata } from 'next';
import { DashboardHome } from '@/components/organizer/dashboard-home';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * Everything above the fold answers one question: how is my business doing
 * today. The KPI strip, then one-click actions, then what just happened.
 *
 * No server fetch: every endpoint under `/organizer/*` is `private, no-store`
 * and scoped to the caller's token, which the server render does not have.
 */
export default function OrganizerDashboardPage() {
  return <DashboardHome />;
}
