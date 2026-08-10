import * as React from 'react';
import type { Metadata } from 'next';
import { SupportQueue } from '@/components/support/support-queue';

export const metadata: Metadata = { title: 'Support' };

/**
 * Queries customers raised about YOUR events, and only those addressed to you.
 * The scoping is the server's — see `SupportRepository.list_for_organizations`.
 */
export default function OrganizerSupportPage() {
  return (
    <div className="flex flex-col gap-block-lg">
      <header className="flex flex-col gap-1">
        <h1 className="text-h3">Support</h1>
        <p className="text-body-sm text-muted-foreground">
          Questions about your events. Replies reach the customer by email.
        </p>
      </header>
      <SupportQueue scope="organizer" />
    </div>
  );
}
