'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogIn } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-provider';
import { AccountMenu } from '@/components/account/account-menu';
import { cn } from '@/lib/utils/cn';

/**
 * The header's account control: "Sign in" when anonymous, an account menu when
 * signed in.
 *
 * SIGNING IN IS THE HEADER'S ONE COMPLETABLE ACTION, so it wears the primary
 * shape of the light-first language: a near-black pill (`bg-cta`) with a white
 * label, fully rounded, `px-pill` wide. It used to be an outline chip, which
 * made the single thing an anonymous visitor can finish the quietest control in
 * the row. In dark theme the same token inverts to a near-white pill with dark
 * text — no second rule, no second class.
 *
 * THREE STATES, ONE WIDTH. Auth resolves on the client (`/auth/me` confirms the
 * stored token), so the first paint genuinely doesn't know the answer. Rather
 * than guess "anonymous" and make every signed-in visitor watch a Sign in
 * button turn into their own avatar, the unresolved state renders a
 * same-sized placeholder — the header never reflows. That placeholder tracks
 * the pill at BOTH widths: a 44px circle below sm (where the control is
 * icon-only) and ~96px at sm and up (where the label replaces the icon). Get
 * that wrong and the header jumps the moment `/auth/me` answers, which is the
 * exact bug this component exists to prevent.
 *
 * NO `useSearchParams` HERE, deliberately. This component sits in the site
 * layout, so reading search params would opt every page under it out of static
 * prerendering — the same trap documented on `site-header`'s nav. The `?next=`
 * destination starts as the pathname and is upgraded to the full URL in an
 * effect after mount, which costs nothing at build time.
 */
export function AccountControl() {
  const pathname = usePathname() ?? '/';
  const { status } = useAuth();
  const [next, setNext] = React.useState(pathname);

  React.useEffect(() => {
    setNext(`${window.location.pathname}${window.location.search}`);
  }, [pathname]);

  if (status === 'unknown') {
    return (
      <div
        className="h-control w-control shrink-0 rounded-full bg-muted sm:w-24"
        aria-hidden
      />
    );
  }

  if (status === 'anonymous') {
    return (
      <Link
        href={next === '/' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(next)}`}
        className={cn(
          'inline-flex h-control shrink-0 items-center justify-center gap-2 rounded-full text-body-sm font-semibold',
          'bg-cta text-cta-foreground shadow-sm',
          // Circular while it is only an icon, so it reads as a control rather
          // than a stub of a button with a label that fell off.
          'w-control px-0 sm:w-auto sm:px-pill',
          'transition-colors duration-fast ease-out hover:bg-cta-hover active:bg-cta-active',
          'active:scale-95 motion-reduce:active:scale-100',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        )}
      >
        {/* The glyph carries the control below sm and the label carries it
            above — a filled pill wants one or the other, not both. */}
        <LogIn className="size-4 shrink-0 sm:hidden" aria-hidden />
        <span className="hidden sm:inline">Sign in</span>
        <span className="sr-only sm:hidden">Sign in</span>
      </Link>
    );
  }

  return <AccountMenu />;
}
