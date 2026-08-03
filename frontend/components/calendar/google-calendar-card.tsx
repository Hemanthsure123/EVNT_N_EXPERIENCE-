'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, CalendarCheck, CalendarPlus, Check } from 'lucide-react';
import {
  disconnectCalendar,
  fetchCalendarStatus,
  startCalendarConnect,
} from '@/lib/api/calendar';
import { ApiError } from '@/lib/api/errors';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

/**
 * Connect or disconnect Google Calendar.
 *
 * ── IT ASKS THE SERVER FIRST ──────────────────────────────────────────────
 *
 * `available` says whether this DEPLOYMENT has OAuth credentials;
 * `connection` says whether this USER has granted them. They are separate
 * because conflating them makes an unconfigured deployment look like an
 * unconnected user, and the UI would offer a Connect button that can only
 * ever 503.
 *
 * ── FOUR STATES, FOUR SENTENCES ───────────────────────────────────────────
 *
 *   unavailable       no credentials here — render nothing at all
 *   disconnected      offer to connect
 *   needs_reconnect   the grant lapsed; say WHY, offer to reconnect
 *   connected         name the account, offer to disconnect
 *
 * `needs_reconnect` is the one that matters. Reverting to "Connect" when a
 * grant is revoked looks like the connection never happened, and the user
 * cannot tell whether their events are still syncing. Saying "Google access
 * was revoked" is a sentence they can act on.
 *
 * ── THE RETURN FROM GOOGLE ────────────────────────────────────────────────
 *
 * The backend's callback redirects here with `?calendar=connected` or
 * `?calendar=error&reason=…&message=…`. Both are turned into a line of text.
 * Silently swallowing the error would leave somebody who pressed Cancel
 * looking at a Connect button, wondering whether it worked.
 */
export function GoogleCalendarCard({ className }: { className?: string }) {
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const [banner, setBanner] = React.useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const status = useQuery({
    queryKey: ['calendar', 'status'],
    queryFn: fetchCalendarStatus,
    staleTime: 30_000,
  });

  // Read the callback outcome once, on mount.
  React.useEffect(() => {
    const outcome = params?.get('calendar');
    if (!outcome) return;
    if (outcome === 'connected') {
      setBanner({ tone: 'ok', text: 'Google Calendar connected.' });
      void queryClient.invalidateQueries({ queryKey: ['calendar', 'status'] });
    } else if (outcome === 'error') {
      setBanner({
        tone: 'error',
        // The backend's own sentence. Never a stack trace, never "an error
        // occurred" — the reasons here are things a person can act on
        // ("you cancelled", "calendar access was not granted").
        text: params?.get('message') || 'Could not connect Google Calendar.',
      });
    }
  }, [params, queryClient]);

  const connect = useMutation({
    mutationFn: startCalendarConnect,
    onSuccess: (result) => {
      // A full navigation, not a fetch: this is Google's consent screen and
      // it must be a top-level document the user can see the URL bar of.
      window.location.assign(result.authorization_url);
    },
    onError: (thrown) =>
      setBanner({
        tone: 'error',
        text:
          thrown instanceof ApiError
            ? thrown.message
            : 'Could not start the Google connection.',
      }),
  });

  const disconnect = useMutation({
    mutationFn: disconnectCalendar,
    onSuccess: () => {
      setBanner({ tone: 'ok', text: 'Google Calendar disconnected.' });
      void queryClient.invalidateQueries({ queryKey: ['calendar', 'status'] });
    },
  });

  // Nothing at all while loading, and nothing where it could never work.
  if (status.isPending) return null;
  if (!status.data?.available) return null;

  const connection = status.data.connection;
  const connected = Boolean(connection?.connected && connection?.calendar_enabled);
  const needsReconnect = Boolean(connection && !connected);

  return (
    <section
      aria-labelledby="google-calendar-heading"
      // The card recipe the rest of the product uses: on a pure-white canvas
      // `bg-surface` is the same value as the page, so it separates with the
      // hairline + `shadow-sm` (see styles/tokens.css), at the shared card
      // radius and `p-card-lg` — this sits directly above two `Panel`s on
      // /account/settings and was the one card on that screen with its own
      // radius and its own padding.
      className={cn(
        'flex flex-col gap-stack-lg rounded-xl border border-border bg-surface p-card-lg shadow-sm',
        className,
      )}
    >
      <div className="flex items-start gap-stack-lg">
        <span
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          aria-hidden
        >
          {connected ? <CalendarCheck className="size-5" /> : <CalendarPlus className="size-5" />}
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 id="google-calendar-heading" className="text-body-lg font-semibold">
            Google Calendar
          </h3>
          <p className="text-body-sm text-muted-foreground">
            {connected
              ? 'Events you book are added to your calendar, with reminders a day and two hours before. If an event moves or is cancelled, the entry is updated or removed.'
              : 'Add the events you book straight to your calendar, with reminders — and let us keep them right if an event moves or is cancelled.'}
          </p>
        </div>
      </div>

      {needsReconnect ? (
        <p className="flex items-start gap-2 rounded-xl border border-warning-subtle bg-warning-subtle p-card text-body-sm text-warning-subtle-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {connection?.status_detail ||
              'Calendar access is no longer working. Reconnect to resume syncing.'}
          </span>
        </p>
      ) : null}

      {connected && connection?.account_email ? (
        <p className="flex items-center gap-2 text-body-sm">
          <Check className="size-4 shrink-0 text-success-subtle-foreground" aria-hidden />
          {/* WHICH account — a person with a work and a personal Google
              account cannot otherwise predict what Disconnect does. */}
          Connected as <span className="font-medium">{connection.account_email}</span>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {/* The shared primitive, not a hand-rolled pair. These were a violet
            `bg-primary` fill and a `rounded-lg` outline at `h-10` (40px) —
            three separate disagreements with the language: violet is the
            WAYFINDING accent and never a button fill (the primary action is
            the near-black `--cta` pill), controls are pills at the shared
            control heights, and 44px is the touch-target floor. `loading`
            renders the same spinner these did and also sets `aria-busy`. */}
        {connected ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => disconnect.mutate()}
            disabled={disconnect.isPending}
            loading={disconnect.isPending}
          >
            Disconnect
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => connect.mutate()}
            disabled={connect.isPending}
            loading={connect.isPending}
          >
            {needsReconnect ? 'Reconnect' : 'Connect Google Calendar'}
          </Button>
        )}

        {connected ? (
          <p className="text-caption text-muted-foreground">
            Disconnecting stops future syncing. Entries already in your calendar stay there — they
            are yours.
          </p>
        ) : null}
      </div>

      {banner ? (
        <p
          role={banner.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'text-caption',
            banner.tone === 'error' ? 'text-destructive' : 'text-success-subtle-foreground',
          )}
        >
          {banner.text}
        </p>
      ) : null}
    </section>
  );
}
