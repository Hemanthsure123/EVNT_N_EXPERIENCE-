'use client';

import * as React from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { useAttention } from '@/lib/organizer/attention';

/**
 * Everything that wants an organizer's attention, in the chrome rather than
 * on the dashboard.
 *
 * ── WHY IT MOVED OFF THE DASHBOARD ────────────────────────────────────────
 *
 * The attention panel was the first thing on the home screen and it was the
 * wrong shape for that position. It is a WORKLIST — a rejected event, a failed
 * payout, a refund waiting on a decision — and a worklist is empty most days.
 * Giving the most valuable strip of the page to a component that usually says
 * "nothing needs you" trained organizers to scroll past the top of their own
 * dashboard, which is the one place a genuine alarm would appear.
 *
 * In the header it is the opposite: costs nothing when empty, is visible from
 * EVERY screen rather than only the home one, and reads as an alarm because it
 * is silent until it is not.
 *
 * ── THE COUNT IS DERIVED, NEVER INVENTED ──────────────────────────────────
 *
 * Same `useAttention()` the dashboard used, so the badge cannot disagree with
 * the list behind it. When those queries fail the badge renders NOTHING rather
 * than zero: "0" is a claim that nothing needs you, and this component must
 * never make that claim on the strength of a failed request.
 */
export function NotificationBell() {
  const { items, isPending, isError } = useAttention();
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  // Dismiss on outside click and on Escape. Both, because a popover that only
  // handles one of them is the kind that gets stuck open on a phone.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const count = isError ? 0 : items.length;
  const urgent = items.some((item) => item.severity === 'critical');

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={count ? `Notifications, ${count} needing attention` : 'Notifications'}
        className="relative size-9 rounded-full p-0"
      >
        <Bell className="size-4" aria-hidden />
        {count > 0 ? (
          <span
            aria-hidden
            className={cn(
              'absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full px-1 text-caption font-medium leading-none text-white',
              // Critical wears the warning colour; anything else is
              // informational and must not look like an alarm, or the alarm
              // stops meaning anything.
              urgent ? 'bg-destructive' : 'bg-nav-active',
            )}
          >
            {count > 9 ? '9+' : count}
          </span>
        ) : null}
      </Button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-11 z-dropdown w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-label">Needs your attention</h2>
            {count > 0 ? (
              <span className="text-caption text-muted-foreground">{count}</span>
            ) : null}
          </div>

          <div className="max-h-[min(26rem,60vh)] overflow-y-auto">
            {isPending ? (
              <p className="px-4 py-6 text-body-sm text-muted-foreground">Checking…</p>
            ) : isError ? (
              // Never "you're all caught up" on a failed request — that is a
              // claim, and the whole point of this control is that silence
              // means something.
              <p className="px-4 py-6 text-body-sm text-muted-foreground">
                Could not check for anything needing attention.
              </p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-body-sm text-muted-foreground">
                Nothing needs you right now.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="flex flex-col gap-0.5 px-4 py-3 transition-colors hover:bg-muted"
                    >
                      <span className="flex items-center gap-2 text-body-sm font-medium text-foreground">
                        <span
                          aria-hidden
                          className={cn(
                            'size-1.5 shrink-0 rounded-full',
                            item.severity === 'critical' ? 'bg-destructive' : 'bg-nav-active',
                          )}
                        />
                        {item.title}
                      </span>
                      <span className="pl-3.5 text-caption text-muted-foreground">
                        {item.detail}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
