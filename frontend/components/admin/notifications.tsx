'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bell, CheckCircle2, ShieldCheck } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { fetchOverview } from '@/lib/api/admin';
import { cn } from '@/lib/utils/cn';

/**
 * The notification centre — things that need an operator to DO something.
 *
 * There is no notifications table on this platform, and inventing one in the
 * browser would produce a bell that lights up for nothing. What does exist is
 * a set of real backlog counters in `/admin/overview`, and those are exactly
 * the actionable items: verifications waiting for a decision, and payouts that
 * dead-lettered. So the bell reports work queues rather than a message feed.
 *
 * "Real-time" here is a 30-second poll, and only while the tab is visible
 * (TanStack's default). A websocket for two counters would be infrastructure
 * with nothing to carry; when a real notification stream exists this component
 * is the one place to change.
 *
 * ── THE TRIGGER IS `Button`, NOT A BUTTON SHAPED LIKE ONE ─────────────────
 *
 * It was a hand-rolled 40px `rounded-md` box, so it neither matched the theme
 * toggle beside it (a 44px `ghost` pill from the same primitive) nor cleared
 * the touch-target floor. `variant="ghost" size="icon"` is that exact
 * treatment, and the badge still positions off the primitive's own `relative`.
 */

const POLL_MS = 30_000;

export function NotificationBell() {
  const { data } = useQuery({
    queryKey: ['admin-overview'],
    queryFn: fetchOverview,
    refetchInterval: POLL_MS,
    staleTime: POLL_MS,
  });

  const items = [
    {
      key: 'verifications',
      count: data?.pending_verifications ?? 0,
      icon: ShieldCheck,
      title: 'Verifications waiting',
      body: 'Organizers who cannot sell until someone decides.',
      href: '/admin/verifications',
      tone: 'warning' as const,
    },
    {
      key: 'payouts',
      count: data?.failed_payouts ?? 0,
      icon: AlertTriangle,
      title: 'Payouts failed',
      body: 'Dead-lettered after retries. The money is still owed.',
      href: '/admin/settlements?status=failed',
      tone: 'destructive' as const,
    },
  ].filter((item) => item.count > 0);

  const total = items.reduce((sum, item) => sum + item.count, 0);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={total ? `Notifications, ${total} needing attention` : 'Notifications'}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <Bell className="size-5" aria-hidden />
          {total ? (
            <span
              className="absolute right-1.5 top-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-caption leading-4 tabular-nums text-destructive-foreground"
              aria-hidden
            >
              {total > 9 ? '9+' : total}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <p className="border-b border-border px-card py-stack text-label text-foreground">
          Needs attention
        </p>

        {items.length ? (
          <ul className="flex flex-col p-2">
            {items.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-start gap-3 rounded-lg p-stack transition-colors duration-fast',
                    'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg',
                      item.tone === 'destructive'
                        ? 'bg-destructive-subtle text-destructive-subtle-foreground'
                        : 'bg-warning-subtle text-warning-subtle-foreground',
                    )}
                    aria-hidden
                  >
                    <item.icon className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-body-sm font-medium tabular-nums text-foreground">
                      {item.count} {item.title.toLowerCase()}
                    </span>
                    <span className="text-caption text-muted-foreground">{item.body}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          // The same all-clear mark the attention panel uses — a tick in a
          // success tint. It was a Wallet glyph, which says "money" rather than
          // "nothing to do", and grey-on-grey read as a disabled control.
          <div className="flex flex-col items-center gap-2 px-card py-8 text-center">
            <span
              className="inline-flex size-8 items-center justify-center rounded-full bg-success-subtle"
              aria-hidden
            >
              <CheckCircle2 className="size-4 text-success" />
            </span>
            <p className="text-body-sm font-medium text-foreground">Nothing needs you right now</p>
            <p className="text-caption text-muted-foreground">
              Verifications and failed payouts appear here.
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
