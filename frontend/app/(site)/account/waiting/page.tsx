import * as React from 'react';
import type { Metadata } from 'next';
import { WaitingList } from '@/components/account/waiting';

export const metadata: Metadata = { title: 'Waiting for tickets' };

/**
 * Events this account asked to be told about.
 *
 * Its own section rather than a tab inside Saved, because the two are different
 * promises: a save is a bookmark this platform does nothing with, and a
 * waiting-list join is something it will act on by writing to you. Folding one
 * into the other would make the heart look like it sends email.
 */
export default function AccountWaitingPage() {
  return <WaitingList />;
}
