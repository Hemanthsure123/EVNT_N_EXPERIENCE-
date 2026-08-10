import * as React from 'react';
import type { Metadata } from 'next';
import { SupportQueue } from '@/components/support/support-queue';

export const metadata: Metadata = { title: 'Support · Console' };

/** Platform-wide. Staff only — enforced by the endpoint, not by this page. */
export default function AdminSupportPage() {
  return (
    <div className="flex flex-col gap-block-lg">
      <header className="flex flex-col gap-1">
        <h1 className="text-h3">Support</h1>
        <p className="text-body-sm text-muted-foreground">
          Queries addressed to the platform, across every organization.
        </p>
      </header>
      <SupportQueue scope="admin" />
    </div>
  );
}
