'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Headset,
  Loader2,
  MapPin,
  Send,
  TicketX,
  TrendingUp,
  X,
} from 'lucide-react';
import { fetchMyBookings } from '@/lib/api/bookings';
import {
  REFUND_REQUEST_LABELS,
  fetchMyRefundRequests,
  type RefundRequest,
} from '@/lib/api/refund-requests';
import { formatMoney } from '@/lib/discovery/format';
import { bookingRef } from '@/lib/ticketing/booking-state';
import { eventPath } from '@/lib/events/ref';
import { AuditTrail, trailProgress, type TrailStep } from '@/components/ticketing/audit-trail';
import { BillLines } from '@/components/ticketing/bill-lines';
import {
  InsetPanel,
  MetaRow,
  PosterThumb,
  StatusChip,
  SurfaceCard,
} from '@/components/ticketing/primitives';
import { ShareReceiptDialog } from './share-receipt';
import { cn } from '@/lib/utils/cn';

/**
 * ONE REFUND, IN FULL.
 *
 * ── WHAT THE PLATFORM ACTUALLY KNOWS ABOUT A REFUND ──────────────────────
 *
 * Two rows, in two tables, answering two questions:
 *
 *   `RefundRequest` — did somebody ask, and what did we decide?
 *                     `created_at`, `decided_at`, `decision_note`, `status`.
 *   `Refund`        — did money actually move?
 *                     the provider's refund id, the amount, `created_at`.
 *
 * That is the whole record, and the second one had NO customer-facing endpoint
 * at all until this screen needed it — so "approved" was the end of what a
 * customer could see, with no reference to quote to a bank and no date the
 * transfer happened. The three `refund_*` fields on `/me/refund-requests` are
 * that gap closed.
 *
 * ── AND WHAT IT CANNOT KNOW, WHICH IS THE LAST STEP ──────────────────────
 *
 * The reference this was built to ends with "Credited to Bank Account ·
 * Settled · Funds available immediately in your account" and a timestamp to
 * the minute. Razorpay's webhook set has no bank-credit event,
 * `reconcile_pending` polls only for CAPTURES, and no bank tells a merchant
 * when a credit landed on the other side. The platform is STRUCTURALLY
 * incapable of learning it.
 *
 * So that step is drawn, and it is drawn honestly: an open marker, no
 * timestamp, and a sentence saying the bank posts it and roughly when. A tick
 * with an invented time there is the single most damaging thing this screen
 * could do — somebody whose money has not arrived would read that it had, and
 * stop chasing it.
 *
 * ── AND THREE SMALLER ONES ───────────────────────────────────────────────
 *
 * · "Credited to Jupiter UPI ***@okaxis" — `Payment` stores the provider's
 *   reference ids, an amount and a status. No method, no network, no last-4,
 *   no bank, no VPA. "Your original payment method" is the true version.
 * · "Cancellation Fee ₹0.00 · 100% REFUND" — there is no cancellation fee
 *   anywhere in this platform. What IS withheld is a DONATION, because a gift
 *   is given rather than paid for, so that is the line the breakdown draws —
 *   and only when there was one.
 * · "Download Refund Receipt" — no refund receipt exists and no endpoint
 *   serves one. The receipt that DOES exist is the booking's, and the backend
 *   emails it; the control says that instead of offering a file nothing
 *   produces.
 */
export function RefundDetail({ requestId }: { requestId: string }) {
  const [sharing, setSharing] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);

  // The list, not a detail endpoint — there is no `GET /refund-requests/{id}`
  // for a customer, and adding one to serve a screen that can select from a
  // page it already has would be an endpoint per view. The same query key the
  // bookings list uses, so arriving from there is instant and cached.
  const requests = useQuery({
    queryKey: ['account', 'refund-requests'],
    queryFn: () => fetchMyRefundRequests(),
    staleTime: 30_000,
  });

  const bookings = useQuery({
    queryKey: ['account', 'bookings'],
    queryFn: () => fetchMyBookings(),
    staleTime: 30_000,
  });

  const request = requests.data?.data.find((row) => row.id === requestId);
  // The refund payload carries an event TITLE and nothing else — no poster, no
  // venue, no ticket count. `/me/bookings` carries all three, and this screen is
  // reached from a list that has already loaded it.
  const booking = bookings.data?.data.find((row) => row.id === request?.booking_id);

  if (requests.isPending) {
    return (
      <div className="flex min-h-96 items-center justify-center">
        <p className="inline-flex items-center gap-2 text-body-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading this refund…
        </p>
      </div>
    );
  }

  if (!request) {
    return (
      <div className="flex flex-col gap-4">
        <RefundHeader />
        <SurfaceCard className="flex flex-col items-start gap-3 p-card-lg">
          <TicketX className="size-6 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-body font-semibold">We could not find that refund</p>
            <p className="mt-1 text-body-sm text-muted-foreground">
              It may belong to another account, or the link may be out of date.
            </p>
          </div>
          <Link
            href="/account/tickets"
            className="inline-flex h-control items-center rounded-full bg-cta px-pill text-label text-cta-foreground transition-colors hover:bg-cta-hover"
          >
            Back to your bookings
          </Link>
        </SurfaceCard>
      </div>
    );
  }

  const settled = Boolean(request.refund_reference);
  // `refund_amount_minor` is what ACTUALLY moved, read off the provider's own
  // record. `booking_total_minor` includes the donation, which an ordinary
  // refund withholds — so using it here would overstate the refund on exactly
  // the screen where being wrong about a number is worst.
  const amount = request.refund_amount_minor ?? request.booking_total_minor - (booking?.donation ?? 0);
  const steps = buildTrail(request);
  const label = REFUND_REQUEST_LABELS[request.status];

  return (
    <div className="flex flex-col gap-4 pb-block">
      <RefundHeader />

      {/* ── THE ANSWER, FIRST ─────────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-2 pt-1 text-center">
        <StatusChip
          tone={settled ? 'refunded' : request.status === 'failed' ? 'failed' : 'pending'}
          icon={settled ? Check : undefined}
        >
          {settled ? 'Refund completed' : label.label}
        </StatusChip>
        <p className="text-h2 font-bold tabular-nums text-foreground">{formatMoney(amount)}</p>
        <p className="max-w-sm text-body-sm text-muted-foreground">
          {settled
            ? 'Credited to your original payment method.'
            : label.customerHint}
        </p>
      </div>

      {/* ── THE REFERENCE A BANK ASKS FOR ─────────────────────────────── */}
      {request.refund_reference ? (
        <InsetPanel className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-caption text-muted-foreground">Refund reference</p>
            <p className="truncate font-mono text-body-sm font-semibold text-foreground">
              {request.refund_reference}
            </p>
          </div>
          <CopyButton value={request.refund_reference} />
        </InsetPanel>
      ) : null}

      {/* ── THE AUDIT TRAIL ───────────────────────────────────────────── */}
      <SurfaceCard className="p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-body font-bold text-foreground">
            <TrendingUp className="size-4 shrink-0 text-primary" aria-hidden />
            Audit trail
          </h2>
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-caption font-medium text-muted-foreground">
            {trailProgress(steps)}
          </span>
        </div>
        <AuditTrail steps={steps} />
      </SurfaceCard>

      {/* ── WHAT WAS REFUNDED ─────────────────────────────────────────── */}
      <SurfaceCard className="p-4">
        <p className="mb-3 flex items-center gap-2 text-caption font-medium text-primary">
          <TicketX className="size-3.5 shrink-0" aria-hidden />
          <span className="font-mono uppercase">{bookingRef(request.booking_id)}</span>
        </p>

        <div className="flex gap-3.5">
          <PosterThumb src={booking?.event_poster_url} alt="" className="size-16" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Link
              href={eventPath({ id: request.event_id, slug: booking?.event_slug })}
              className="block truncate text-body font-bold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {request.event_title}
            </Link>
            <MetaRow icon={CalendarDays}>
              {new Date(request.event_starts_at).toLocaleDateString('en-IN', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </MetaRow>
            {/* Absent, not blank, when this screen was opened without the
                booking row — `MetaRow` renders nothing for an empty value. */}
            <MetaRow icon={MapPin}>
              {booking ? [booking.event_venue, booking.event_city].filter(Boolean).join(', ') : ''}
            </MetaRow>
          </div>
        </div>

        <InsetPanel className="mt-3">
          <BillLines
            lines={[
              { label: 'Original total paid', amount: request.booking_total_minor },
              // THE ONLY THING WITHHELD, and only when there was one. There is
              // no cancellation fee in this platform; a donation is retained
              // because a gift is given rather than paid for — except on a
              // booking that never issued a ticket, which is refunded whole.
              booking?.donation
                ? { label: 'Donation (not refunded)', amount: booking.donation, credit: true }
                : { label: 'Donation', amount: null },
            ]}
            total={amount}
            totalLabel={settled ? 'Total refunded' : 'Refundable'}
          />
        </InsetPanel>
      </SurfaceCard>

      {/* ── THE QUESTION EVERYBODY ASKS ───────────────────────────────── */}
      <SurfaceCard>
        <button
          type="button"
          onClick={() => setHelpOpen((open) => !open)}
          aria-expanded={helpOpen}
          className="flex w-full items-center gap-3 p-4 text-left transition-colors duration-fast hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
        >
          <span
            aria-hidden
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-warning-subtle text-warning-subtle-foreground"
          >
            <CircleHelp className="size-4" />
          </span>
          <span className="min-w-0 flex-1 text-body-sm font-semibold text-foreground">
            Still haven&rsquo;t received the refund?
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform duration-fast motion-reduce:transition-none',
              helpOpen && 'rotate-180',
            )}
          />
        </button>
        {helpOpen ? (
          <div className="border-t border-border px-4 py-3 text-body-sm text-muted-foreground">
            {/* THE POLICY SENTENCE, NOT A COMPUTED DATE. There is no
                `expected_credit_by` column and no per-method window — the
                method itself is not even stored — so a date here would be a
                number with nothing behind it on the screen where somebody is
                already worried about money. */}
            <p>
              Once the provider accepts a refund it is your bank that posts it. Cards typically
              take 5–7 working days and UPI 1–3, counted from the date above.
            </p>
            <p className="mt-2">
              If it has been longer, quote the refund reference to your bank first — they can
              trace it with that alone. We can help if they cannot find it.
            </p>
          </div>
        ) : null}
      </SurfaceCard>

      {/* ── WHAT IS LEFT TO DO ────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setSharing(true)}
          className="inline-flex h-control w-full items-center justify-center gap-2 rounded-full border border-border bg-surface text-label text-foreground transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
        >
          <Send className="size-4" aria-hidden />
          {/* NOT "Download refund receipt". No refund receipt exists and no
              endpoint serves one; the booking receipt does, and the backend
              emails it as a PDF. */}
          Email the booking receipt
        </button>
        <Link
          href="/support"
          className="inline-flex h-control-lg w-full items-center justify-center gap-2 rounded-full bg-cta px-pill-lg text-label text-cta-foreground shadow-sm transition-colors duration-fast hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
        >
          <Headset className="size-4" aria-hidden />
          Contact support
        </Link>
      </div>

      <ShareReceiptDialog
        target={
          sharing
            ? {
                bookingId: request.booking_id,
                eventTitle: request.event_title,
                ticketCount: booking?.ticket_count ?? 1,
              }
            : null
        }
        onClose={() => setSharing(false)}
      />
    </div>
  );
}

function RefundHeader() {
  return (
    <div className="flex items-center justify-between gap-3">
      <Link
        href="/account/tickets"
        aria-label="Back to your bookings"
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        <ArrowLeft className="size-5" aria-hidden />
      </Link>
      <h1 className="min-w-0 flex-1 truncate text-center text-body font-bold">Refund details</h1>
      <Link
        href="/account/tickets"
        aria-label="Close"
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        <X className="size-4" aria-hidden />
      </Link>
    </div>
  );
}

/**
 * The four steps, and the state of each is read off a timestamp.
 *
 * Step 1 is "You asked", not "Booking cancelled". A refund does NOT cancel a
 * booking: `BookingStatus` has no `refunded` member and a refunded booking
 * stays `paid` — what changes is the TICKETS, which go `active` → `void`. The
 * reference's first step describes a lifecycle this platform does not have.
 */
function buildTrail(request: RefundRequest): TrailStep[] {
  const decided = Boolean(request.decided_at);
  const approved = request.status === 'approved' || Boolean(request.refund_reference);
  const settled = Boolean(request.refunded_at);

  return [
    {
      title: 'You asked for a refund',
      at: request.created_at,
      state: 'done',
      body: request.reason ? `“${request.reason}”` : undefined,
    },
    {
      title:
        request.status === 'rejected'
          ? 'Declined by the organiser'
          : decided
            ? 'Approved by the organiser'
            : 'With the organiser',
      at: request.decided_at,
      state: decided ? 'done' : 'active',
      body:
        request.decision_note ||
        (decided ? undefined : 'They will decide, and you get an email either way.'),
    },
    {
      title: 'Sent to your payment provider',
      at: request.refunded_at,
      state: settled ? 'done' : request.status === 'failed' ? 'unknowable' : approved ? 'active' : 'waiting',
      body:
        request.status === 'failed'
          ? 'The transfer did not go through. Contact support and we will re-run it.'
          : settled
            ? 'The provider accepted the refund and released the funds.'
            : undefined,
    },
    {
      // ALWAYS `unknowable`, whatever else happened. See the note at the top of
      // this file: no webhook, no poll and no bank tells this platform when a
      // credit landed, so there is no state of the world in which we could put
      // a tick and a time here honestly.
      title: 'Posted by your bank',
      state: 'unknowable',
      body: settled
        ? 'Banks post a credit on their own schedule — typically 1–3 working days for UPI and 5–7 for cards. We are not told when it lands.'
        : 'This happens after the provider releases the funds.',
    },
  ];
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => setCopied(true))
          .catch(() => undefined);
      }}
      className="inline-flex h-control-sm shrink-0 items-center gap-1.5 rounded-full bg-surface px-3 text-label text-primary shadow-sm transition-colors duration-fast hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
