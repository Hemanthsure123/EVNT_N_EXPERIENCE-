'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, Ticket, UserCog } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/lib/auth/auth-provider';
import { cn } from '@/lib/utils/cn';

/**
 * Who you are signed in as, and the way out.
 *
 * ── THE AVATAR IS A WARM CREAM CIRCLE, NOT A BRAND GRADIENT ───────────────
 *
 * It was `bg-gradient-brand` — a violet→violet gradient in the most prominent
 * slot of the console header, which is exactly the chrome the light-first
 * language quietens, and the loudest thing on a screen whose job is to be read.
 * It now matches the attendee site's personal avatar
 * (`components/account/account-menu.tsx`): a `--nav-active` circle with dark
 * ink. One avatar language across both portals, and the operator moving between
 * them recognises themselves in the same shape.
 *
 * It is `h-control w-control` (44px), the same box as every other control in
 * this header, so the row lines up by token rather than by three components
 * happening to pick similar numbers — and it clears the touch-target floor,
 * which the old 36px circle did not.
 *
 * SIGN OUT IS SEPARATED BY A RULE. It ends the session, and a control that
 * ends something should never sit flush against a routine navigation link
 * where a mis-aimed click lands on it.
 */
export function UserMenu() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  const initials = (user?.full_name || user?.email || '?')
    .split(/[\s@.]+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <Popover>
      <PopoverTrigger
        aria-label="Account menu"
        className={cn(
          'inline-flex h-control w-control shrink-0 items-center justify-center rounded-full',
          'bg-nav-active text-caption font-semibold text-nav-active-foreground',
          'transition-colors duration-fast hover:bg-nav-active-hover',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        )}
      >
        {initials}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-64 p-2">
        <div className="flex flex-col gap-0.5 border-b border-border px-3 pb-stack pt-1">
          <p className="truncate text-body-sm font-medium text-foreground">
            {user?.full_name || 'Operator'}
          </p>
          <p className="truncate text-caption text-muted-foreground">{user?.email}</p>
          <p className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-caption text-secondary-foreground">
            <UserCog className="size-3" aria-hidden />
            Platform operator
          </p>
        </div>

        <Link
          href="/"
          className={cn(
            'mt-1 flex min-h-control items-center gap-3 rounded-full px-3 py-2 text-body-sm',
            'transition-colors duration-fast hover:bg-muted',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <Ticket className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          Attendee site
        </Link>

        <div className="mt-1 border-t border-border pt-1">
          <button
            type="button"
            onClick={() => {
              void signOut().then(() => router.push('/'));
            }}
            className={cn(
              'flex min-h-control w-full items-center gap-3 rounded-full px-3 py-2 text-body-sm',
              'transition-colors duration-fast hover:bg-muted',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <LogOut className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            Sign out
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
