'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarDays,
  CircleAlert,
  Clock3,
  Info,
  Lightbulb,
  Loader2,
  Lock,
  MapPin,
  RotateCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { fetchBooking } from '@/lib/api/bookings';
import { useAuth } from '@/lib/auth/auth-provider';
import { bookingRef } from '@/lib/ticketing/booking-state';
import { eventPath } from '@/lib/events/ref';
import {
  describeFailure,
  failureSource,
  forgetFailure,
  recallFailure,
} from '@/lib/booking/payment-failure';
import type { CheckoutFailure } from '@/lib/booking/razorpay';
import { BillLines, bookingBill } from '@/components/ticketing/bill-lines';
import {
  InsetPanel,
  MetaRow,
  PosterThumb,
  SurfaceCard,
} from '@/components/ticketing/primitives';
import { PaymentSection, PayUsing } from './payment-section';
import { StickyActionBar } from './sticky-action-bar';
import { useBooking } from './booking-context';
import { cn } from '@/lib/utils/cn';

/**
 * PAYMENT STATUS — the screen a refused payment lands on.
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────
 *
 * A failed payment used to be a red paragraph above the Pay button on the
 * review screen, and it was the only thing the customer got. Three facts they
 * needed were missing, and two of them were already in the browser:
 *
 *   1. WHAT HAPPENED. Razorpay hands `checkout.on('payment.failed')` a full
 *      error object — `code`, `reason`, `source`, `step` and the payment id.
 *      This codebase read `description` and discarded the rest, so nothing
 *      could tell "your bank declined it" from "the gateway timed out", and
 *      support had no reference to look anything up by.
 *   2. WHETHER MONEY LEFT. On a timeout it genuinely may have, and it comes
 *      back on its own. Nobody was told that.
 *   3. WHETHER THE SEATS WERE STILL THEIRS. They were — the hold survives a
 *      failed payment untouched — and the screen never said so, so the
 *      rational move looked like starting again from the event page, which
 *      would have cost them the hold they still had.
 *
 * ── WHAT THIS SCREEN IS CAREFUL NOT TO CLAIM ─────────────────────────────
 *
 * The gateway never tells our BACKEND that a customer's card was declined.
 * There is no `failed` member of `Booking['status']`, no failure row a customer
 * can read, and `_process_failed` records a hard-coded reason rather than the
 * gateway's. So everything specific on this screen comes from THIS TAB'S
 * checkout attempt, held in `sessionStorage` and keyed to this booking. Arrive
 * here by any other route — a reload after clearing storage, a shared link, a
 * different device — and the specifics are simply absent while the amount, the
 * hold and the retry stay exactly right.
 *
 * The reference this was built to also shows a discount line ("Early Bird
 * Festival Perk −₹200") and a separate "convenience fee". There is no coupon
 * mechanism in this platform and exactly ONE fee. Neither is drawn.
 */
export function PaymentFailedStep() {
  const { event } = useBooking();
  const { status } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const bookingId = params?.get('booking') ?? null;

  const [failure, setFailure] = React.useState<CheckoutFailure | null>(null);
  // Read after mount: `sessionStorage` does not exist on the server, and
  // reading it during render would make the first client paint disagree with
  // the markup Next already sent.
  React.useEffect(() => {
    if (bookingId) setFailure(recallFailure(bookingId));
  }, [bookingId]);

  const [now, setNow] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const query = useQuery({
    queryKey: ['booking', bookingId],
    queryFn: () => fetchBooking(bookingId as string),
    enabled: Boolean(bookingId) && status === 'authenticated',
    // The hold is the whole question on this screen and it is ticking, so the
    // row is never served from a stale cache here.
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const booking = query.data;
  const copy = describeFailure(failure);

  // The hold, re-derived from the row's own timestamp on every tick rather than
  // from a boolean computed at mount — the same rule the pay button follows.
  const deadline = booking?.hold_expires_at ? Date.parse(booking.hold_expires_at) : null;
  const secondsLeft = deadline ? Math.max(0, Math.floor((deadline - now) / 1000)) : 0;
  const holdLive = booking?.status === 'reserved' && secondsLeft > 0;

  // A payment that succeeded after all — the webhook can land while somebody is
  // still reading this. Send them to the ticket rather than leaving them on a
  // screen telling them it did not work.
  React.useEffect(() => {
    if (booking?.status === 'paid' && bookingId) {
      forgetFailure();
      router.replace(`/booking/${event.id}/confirmation?booking=${encodeURIComponent(bookingId)}`);
    }
  }, [booking?.status, bookingId, event.id, router]);

  return (
    <div className="flex flex-col gap-4 pb-block-lg">
      {/* ── HEADER ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/booking/${event.id}/review`}
          aria-label="Back to your booking"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <p className="min-w-0 flex-1 truncate text-center text-body font-bold">Payment status</p>
        <Link
          href={eventPath(event)}
          aria-label="Leave checkout"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        >
          <X className="size-5" aria-hidden />
        </Link>
      </div>

      {/* ── THE VERDICT ───────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-destructive-subtle p-4">
        <div className="flex gap-3">
          <span
            aria-hidden
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
          >
            <CircleAlert className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-caption font-bold uppercase tracking-wider text-destructive-subtle-foreground">
              Payment incomplete
            </p>
            <h1 className="mt-0.5 text-h4 font-bold text-destructive-subtle-foreground">
              {copy.title}
            </h1>
            {/* ONE sentence here, and the SPECIFIC advice lower down in the
                diagnostics block. Both said the reversal line and a screen that
                prints the same reassurance twice in two registers reads as a
                system that is not sure. */}
            <p className="mt-1.5 text-body-sm text-destructive-subtle-foreground">
              Nothing has been charged for this booking.
            </p>
          </div>
        </div>

        {/* ── THE SEATS ARE STILL YOURS, AND FOR HOW LONG ────────────── */}
        {query.isPending ? (
          <div className="mt-3 h-14 rounded-xl bg-surface/60" aria-hidden />
        ) : holdLive ? (
          <div className="mt-3 flex items-center gap-3 rounded-xl bg-surface p-3">
            <span
              aria-hidden
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-warning-subtle text-warning-subtle-foreground"
            >
              <Clock3 className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-body-sm font-semibold text-foreground">Your tickets are held</p>
              <p className="text-caption text-muted-foreground">
                {booking?.items?.length
                  ? `${booking.items.reduce((sum, line) => sum + line.quantity, 0)} passes at the price you chose.`
                  : 'At the price you chose.'}{' '}
                Finish paying before the timer ends.
              </p>
            </div>
            <p
              className="shrink-0 text-body font-bold tabular-nums text-primary"
              role="timer"
              aria-live="off"
            >
              {clock(secondsLeft)}
            </p>
          </div>
        ) : booking ? (
          <div className="mt-3 rounded-xl bg-surface p-3">
            <p className="text-body-sm font-semibold text-foreground">
              The hold on these tickets has ended
            </p>
            <p className="mt-0.5 text-caption text-muted-foreground">
              They went back on sale. You can choose them again from the event page — the price and
              availability are whatever they are now.
            </p>
          </div>
        ) : null}
      </div>

      {/* ── WHAT WAS BEING PAID FOR ───────────────────────────────────── */}
      {booking ? (
        <SurfaceCard className="p-4">
          <div className="flex gap-3.5">
            <PosterThumb src={event.poster_url} alt="" className="size-16" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="truncate text-body font-bold text-foreground">{event.title}</p>
              <MetaRow icon={CalendarDays}>
                {new Date(event.starts_at).toLocaleString('en-IN', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true,
                })}
              </MetaRow>
              <MetaRow icon={MapPin}>
                {[event.venue, event.city].filter(Boolean).join(', ')}
              </MetaRow>
            </div>
          </div>

          <InsetPanel className="mt-3">
            {/* The SAME component the confirmation's bill and the refund's
                breakdown use — one implementation of the rule that
                `total_amount` already contains the fee and the donation. */}
            <BillLines {...bookingBill(booking)} totalLabel="Total payable" />
          </InsetPanel>
        </SurfaceCard>
      ) : query.isPending ? (
        <div className="skeleton h-52 w-full rounded-2xl" aria-hidden />
      ) : null}

      {/* ── GATEWAY DIAGNOSTICS ───────────────────────────────────────
          Present ONLY where the gateway actually said something. An empty
          diagnostics panel with "—" in every row is worse than no panel: it
          reads as a system that checked and found nothing, when the truth is
          that this tab never had the answer. */}
      {failure && (failure.code || failure.reason || failure.paymentId || copy.providerMessage) ? (
        <SurfaceCard className="p-4">
          <p className="flex items-center gap-2 text-body-sm font-semibold text-foreground">
            <Info className="size-4 shrink-0 text-destructive" aria-hidden />
            Gateway diagnostics
          </p>

          <InsetPanel className="mt-3">
            <dl className="flex flex-col gap-2">
              {failure.reason ? (
                <Diagnostic label="Reason">
                  <code className="font-mono text-caption uppercase">{failure.reason}</code>
                </Diagnostic>
              ) : null}
              {failure.code ? (
                <Diagnostic label="Code">
                  <code className="font-mono text-caption uppercase">{failure.code}</code>
                </Diagnostic>
              ) : null}
              {failureSource(failure.source) ? (
                <Diagnostic label="Reported by">{failureSource(failure.source)}</Diagnostic>
              ) : null}
              {failure.paymentId ? (
                <Diagnostic label="Payment reference">
                  <code className="break-all font-mono text-caption">{failure.paymentId}</code>
                </Diagnostic>
              ) : null}
              {bookingId ? (
                <Diagnostic label="Booking">
                  <code className="font-mono text-caption">{bookingRef(bookingId)}</code>
                </Diagnostic>
              ) : null}
            </dl>
            {copy.providerMessage ? (
              <p className="mt-2.5 border-t border-border pt-2.5 text-caption text-muted-foreground">
                {copy.providerMessage}
              </p>
            ) : null}
          </InsetPanel>

          <p className="mt-3 flex items-start gap-2 text-caption text-primary">
            <Lightbulb className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {copy.advice}
          </p>
        </SurfaceCard>
      ) : null}

      {/* ── WHAT TO DO ────────────────────────────────────────────────
          `PaymentSection` in `full`, so the retry is the SAME control that
          failed — same hold re-check at press time, same provider resolution,
          same demo-mode notice where no provider is configured. A second pay
          path written for this screen would be a second place for the money
          path to be wrong. */}
      {booking && holdLive ? (
        <div className="flex flex-col gap-3">
          {/* `notice` + `compact`, the SAME pairing the review screen uses, and
              for the same reason. `full`'s own button is `hidden lg:inline-flex`
              — on the review screen the phone's action lives in the sticky bar —
              so rendering `full` alone put a retry screen on a phone with an
              explanation of Razorpay's checkout and no way to open it. That is
              the mirror image of the failure `PaymentSection`'s docstring warns
              about, and the screenshot pass is what caught it. */}
          <PaymentSection event={event} active={booking} layout="notice" />
          {/* NOT "Change payment method". Razorpay Checkout is a hosted modal
              and the instrument is chosen INSIDE it — there is no method list
              on this origin to change to and no stored instrument to change
              from. The bar below reopens exactly that modal, which is where the
              choice actually happens, and this line says so. */}
          <p className="flex items-center justify-center gap-1.5 text-caption text-muted-foreground">
            <RotateCw className="size-3.5 shrink-0" aria-hidden />
            Card, UPI, net banking and wallets are all chosen inside the payment window.
          </p>
          <StickyActionBar total={booking.total_amount} caption="Total" leading={<PayUsing />}>
            <PaymentSection event={event} active={booking} layout="compact" />
          </StickyActionBar>
        </div>
      ) : booking ? (
        <Link
          href={eventPath(event)}
          className="inline-flex h-control-lg w-full items-center justify-center rounded-full bg-cta px-pill-lg text-label text-cta-foreground shadow-sm transition-colors duration-fast hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
        >
          Choose tickets again
        </Link>
      ) : query.isError ? (
        <div className="rounded-2xl border border-border bg-surface p-4 text-body-sm text-muted-foreground">
          <p>We could not load this booking.</p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="mt-2 inline-flex h-control items-center rounded-full border border-border px-4 text-label text-foreground transition-colors hover:bg-muted"
          >
            <Loader2
              className={cn('mr-2 size-3.5', query.isFetching ? 'animate-spin' : 'hidden')}
              aria-hidden
            />
            Try again
          </button>
        </div>
      ) : null}

      <Link
        href="/support"
        className="inline-flex h-control w-full items-center justify-center gap-2 rounded-full text-label text-primary transition-colors duration-fast hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        Need help? Check the status of a debit
      </Link>

      <p className="flex items-center justify-center gap-2 rounded-xl bg-success-subtle px-4 py-3 text-caption text-success-subtle-foreground">
        <ShieldCheck className="size-4 shrink-0" aria-hidden />
        {/* Both halves are true and neither is a guarantee nobody underwrites:
            the payment happens on the provider's own encrypted checkout, and
            `Payment` stores reference ids and an amount — no card data, ever. */}
        Paid on the provider&rsquo;s encrypted checkout
        <Lock className="size-3.5 shrink-0" aria-hidden />
        no card details stored
      </p>
    </div>
  );
}

function Diagnostic({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-caption text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-caption text-foreground">{children}</dd>
    </div>
  );
}

/** mm:ss, floored at zero. A countdown that goes negative is a countdown that
 *  outlived the thing it was counting. */
function clock(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, '0')}`;
}
