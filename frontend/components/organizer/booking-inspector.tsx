'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  CircleDollarSign,
  Clock,
  Copy,
  Receipt,
  Ticket,
  TimerOff,
  User,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { formatMoney } from '@/lib/discovery/format';
import type { OrganizerBooking } from '@/lib/api/organizer';
import { cn } from '@/lib/utils/cn';
import { TOOLBAR_ICON } from './data-table';
import { RefundAction } from './refund-action';
import { BookingBadge } from './status-badge';

/**
 * The booking inspector — everything an organizer answering a support call
 * needs to read out, without leaving the table.
 *
 * ── THE TIMELINE IS RECONSTRUCTED FROM STORED FACTS, NOT FROM AN EVENT LOG ─
 *
 * There is no per-booking audit trail endpoint. What there IS: `created_at`
 * (the hold was taken), `hold_expires_at` (when it lapses or lapsed),
 * `payment_ref` (present only once a signed webhook confirmed payment), and
 * `status`. Those four facts determine the lifecycle completely, because the
 * lifecycle only has four states — so the timeline below is DERIVED and
 * exact, not guessed.
 *
 * What it deliberately cannot show is *when* the transition happened for
 * anything but creation and expiry: nothing stores a `paid_at` or a
 * `cancelled_at`. So those steps say what happened without inventing a
 * timestamp. BACKLOG "Booking state transition timestamps" covers the columns.
 *
 * ── THE ONE WRITE, AND WHY IT COULD NOT BE HERE BEFORE ────────────────────
 *
 * `POST /payments/{id}/refund` needs our `Payment.id`. This row used to carry
 * only `payment_ref` — Razorpay's id, a DIFFERENT value — so a refund button
 * here would have meant guessing a handle on the money path. The payload now
 * carries `payment_id`, computed server-side as the payment that can actually
 * be refunded, so `RefundAction` enables on a fact rather than an inference.
 *
 * It lives in its own file precisely because everything ELSE on this panel
 * navigates or copies a reference. That is also why nothing else here is a
 * filled pill: a near-black button on a support screen whose job is to let
 * somebody read a number out loud correctly would read as "do the thing".
 */
export function BookingInspector({
  booking,
  onClose,
}: {
  booking: OrganizerBooking | null;
  onClose: () => void;
}) {
  // Held through the close animation, so the panel does not collapse to zero
  // height mid-transition.
  const [sticky, setSticky] = React.useState<OrganizerBooking | null>(booking);
  React.useEffect(() => {
    if (booking) setSticky(booking);
  }, [booking]);

  const shown = booking ?? sticky;

  return (
    <Drawer open={Boolean(booking)} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent side="responsive" hideClose className="flex flex-col gap-0 p-0 sm:max-w-lg">
        {shown ? (
          <>
            <header className="flex items-start gap-3 border-b border-border p-card">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <BookingBadge status={shown.status} />
                  <CopyableId label="Booking" value={shown.id} />
                </div>
                <h2 className="mt-1 truncate text-h4">
                  {shown.customer_name || shown.customer_email}
                </h2>
                <p className="truncate text-body-sm text-muted-foreground">
                  {shown.customer_email}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                aria-label="Close"
                className={cn(TOOLBAR_ICON, 'shrink-0')}
              >
                <X className="size-4" aria-hidden />
              </Button>
            </header>

            <div className="flex flex-1 flex-col gap-block overflow-y-auto p-card">
              <section className="grid grid-cols-2 gap-2">
                <Cell
                  icon={CircleDollarSign}
                  label="Total paid"
                  value={formatMoney(shown.total_amount_minor)}
                />
                <Cell
                  icon={Receipt}
                  label="Platform fee"
                  value={formatMoney(shown.platform_fee_minor)}
                  // The fee comes OUT of the total at settlement rather than
                  // being charged on top, and an organizer reading this line
                  // needs to know which.
                  hint="Deducted from the total, not added to it"
                />
                <Cell icon={Ticket} label="Tickets" value={String(shown.quantity)} />
                <Cell
                  icon={User}
                  label="Your share"
                  value={formatMoney(shown.total_amount_minor - shown.platform_fee_minor)}
                  hint="Before refunds; released after the event"
                />
              </section>

              <section className="flex flex-col gap-stack">
                <h3 className="text-body-sm font-semibold">Event</h3>
                <Link
                  href={`/dashboard/events?event=${shown.event_id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border p-stack transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-body-sm font-medium">
                      {shown.event_title}
                    </span>
                    <span className="block text-caption tabular-nums text-muted-foreground">
                      {new Date(shown.event_starts_at).toLocaleString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </span>
                </Link>
              </section>

              <section className="flex flex-col gap-stack">
                <h3 className="text-body-sm font-semibold">What happened</h3>
                <Timeline booking={shown} />
              </section>

              <section className="flex flex-col gap-stack">
                <h3 className="text-body-sm font-semibold">References</h3>
                <dl className="flex flex-col gap-1.5">
                  <RefRow label="Booking id" value={shown.id} />
                  <RefRow label="Customer id" value={shown.customer_id} />
                  <RefRow
                    label="Payment reference"
                    value={shown.payment_ref}
                    empty="No payment captured"
                  />
                </dl>
                <p className="text-caption text-muted-foreground">
                  Quote this when contacting support about a charge.
                </p>
              </section>

              <Button variant="outline" asChild className="w-fit">
                <Link href={`/dashboard/customers?customer=${shown.customer_id}`}>
                  <User className="size-3.5" aria-hidden />
                  View this customer
                </Link>
              </Button>

              {/* Renders nothing unless there is a payment that can actually
                  be returned, so a hold or an already-refunded booking shows
                  no dead control. */}
              <RefundAction booking={shown} />
            </div>
          </>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}

/**
 * The lifecycle, derived from the four stored facts.
 *
 * `reserved -> (paid | cancelled | expired)` is the whole state machine (see
 * the repo's CLAUDE.md), so four facts determine it completely. Steps whose
 * time is not stored say so rather than borrowing another step's timestamp.
 */
function Timeline({ booking }: { booking: OrganizerBooking }) {
  const created = new Date(booking.created_at);
  const expires = new Date(booking.hold_expires_at);
  const lapsed = expires.getTime() < Date.now();

  const steps: {
    icon: LucideIcon;
    title: string;
    detail: string;
    at: Date | null;
    tone: string;
  }[] = [
    {
      icon: Clock,
      title: 'Tickets held',
      detail: `${booking.quantity} ticket${booking.quantity === 1 ? '' : 's'} reserved out of inventory`,
      at: created,
      tone: 'bg-muted text-muted-foreground',
    },
  ];

  if (booking.status === 'paid') {
    steps.push({
      icon: CircleDollarSign,
      title: 'Payment confirmed',
      detail: booking.payment_ref
        ? `Verified webhook, reference ${booking.payment_ref}`
        : 'Verified by a signed webhook',
      at: null,
      tone: 'bg-success-subtle text-success-subtle-foreground',
    });
    steps.push({
      icon: Ticket,
      title: 'Tickets issued',
      detail: 'Each carries a signed QR, valid for one scan',
      at: null,
      tone: 'bg-success-subtle text-success-subtle-foreground',
    });
  } else if (booking.status === 'expired') {
    steps.push({
      icon: TimerOff,
      title: 'Hold expired',
      detail: 'The inventory was released back for sale',
      at: expires,
      tone: 'bg-muted text-muted-foreground',
    });
  } else if (booking.status === 'cancelled') {
    steps.push({
      icon: TimerOff,
      title: 'Cancelled',
      detail: 'The inventory was released back for sale',
      at: null,
      tone: 'bg-muted text-muted-foreground',
    });
  } else {
    steps.push({
      icon: TimerOff,
      title: lapsed ? 'Hold has lapsed' : 'Hold expires',
      detail: lapsed
        ? 'The sweeper releases lapsed holds; this row will move to Expired'
        : 'Payment must complete before this, or the tickets go back on sale',
      at: expires,
      // Both arms of this used to be the identical warning tint, so a hold
      // that had ALREADY lapsed looked exactly like one still counting down —
      // which is the one distinction somebody opens this panel to make. A
      // lapsed hold is a sale that is gone, so it reads as a loss.
      tone: lapsed
        ? 'bg-destructive-subtle text-destructive-subtle-foreground'
        : 'bg-warning-subtle text-warning-subtle-foreground',
    });
  }

  return (
    <ol className="flex flex-col">
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-3">
          <span className="flex flex-col items-center" aria-hidden>
            <span
              className={cn(
                'inline-flex size-7 shrink-0 items-center justify-center rounded-full',
                step.tone,
              )}
            >
              <step.icon className="size-3.5" />
            </span>
            {index < steps.length - 1 ? <span className="w-px flex-1 bg-border" /> : null}
          </span>
          <span className={cn('flex min-w-0 flex-1 flex-col', index < steps.length - 1 && 'pb-4')}>
            <span className="text-body-sm font-medium">{step.title}</span>
            <span className="text-caption text-muted-foreground">{step.detail}</span>
            {step.at ? (
              <time
                dateTime={step.at.toISOString()}
                className="text-caption tabular-nums text-muted-foreground"
              >
                {step.at.toLocaleString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </time>
            ) : (
              // Rather than borrowing the previous step's clock, which would
              // read as a fact.
              <span className="text-caption text-muted-foreground">Time not recorded</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Cell({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border p-stack">
      {/* The leading icon is one of the few places the wayfinding violet
          survives — an accent on a label, never a fill on a control. */}
      <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
        <Icon className="size-3 text-primary" aria-hidden />
        {label}
      </p>
      <p className="mt-0.5 text-body tabular-nums text-foreground">{value}</p>
      {hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function RefRow({ label, value, empty }: { label: string; value: string; empty?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-caption text-muted-foreground">{label}</dt>
      <dd className="min-w-0">
        {value ? (
          <CopyableId label={label} value={value} />
        ) : (
          <span className="text-caption text-muted-foreground">{empty ?? '—'}</span>
        )}
      </dd>
    </div>
  );
}

/**
 * An id you can actually use.
 *
 * A uuid shown but not copyable is a uuid somebody transcribes by hand into a
 * support ticket, with a typo. Falls back to a `<span>` when the clipboard API
 * is unavailable (insecure origin) rather than offering a button that fails.
 */
function CopyableId({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    return <span className="truncate font-mono text-caption text-muted-foreground">{value}</span>;
  }

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => setCopied(true));
      }}
      aria-label={`Copy ${label}`}
      className="group inline-flex max-w-full items-center gap-1 rounded-sm font-mono text-caption text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="truncate">{copied ? 'Copied' : value}</span>
      <Copy
        className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden
      />
    </button>
  );
}
