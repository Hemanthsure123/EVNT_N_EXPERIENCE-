'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserRound } from 'lucide-react';
import { AccountMenu } from '@/components/account/account-menu';
import { useAuth } from '@/lib/auth/auth-provider';

/**
 * The avatar in the mobile event page's header.
 *
 * Signed in, it is `AccountMenu` — the SAME drawer the home page's avatar
 * opens, drawn as a bare circle and lifted above the event page's own layer.
 * While the session is still resolving it is a circle of the same size, so the
 * header does not shift when `/auth/me` answers. Signed out there is no profile
 * to show, so the circle is the way to sign in, and it comes back to this
 * event afterwards.
 */
export function DeckAccount() {
  const { status } = useAuth();
  const pathname = usePathname() ?? '/';

  if (status === 'unknown') {
    return <span aria-hidden className="size-control shrink-0 rounded-full bg-muted" />;
  }

  if (status === 'anonymous') {
    return (
      <Link
        href={pathname === '/' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(pathname)}`}
        aria-label="Sign in"
        className="inline-flex size-control shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground transition-colors duration-fast hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <UserRound className="size-5" aria-hidden />
      </Link>
    );
  }

  return <AccountMenu variant="avatar" layer="overlay" />;
}
