import * as React from 'react';
import type { Metadata } from 'next';
import { Container } from '@/components/shell/container';
import { AccountShell } from '@/components/account/account-shell';

export const metadata: Metadata = {
  title: { default: 'Account', template: '%s · Your account · Curatix' },
  // Personal pages have nothing to offer a crawler.
  robots: { index: false, follow: false },
};

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <Container>
      <AccountShell>{children}</AccountShell>
    </Container>
  );
}
