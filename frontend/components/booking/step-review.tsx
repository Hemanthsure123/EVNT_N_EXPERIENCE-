'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Loader2,
  MapPin,
  Navigation,
  Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createBooking } from '@/lib/api/bookings';
import { ApiError } from '@/lib/api/errors';
import { useAuth } from '@/lib/auth/auth-provider';
import { rememberProvider } from '@/lib/booking/payment-provider';
import { rememberKeyId } from '@/lib/booking/razorpay';
import {
  SELECTION_PARAM,
  idempotencyKeyFor,
  serialiseSelection,
  toBookingItems,
} from '@/lib/booking/selection';
import { inferCategory } from '@/lib/discovery/categories';
import { formatEventDateLong, formatEventTime, formatFromPrice } from '@/lib/discovery/format';
import { cn } from '@/lib/utils/cn';
import { CTA_PILL_LG, PILL_MD } from './cta';
import { useBooking } from './booking-context';
import { Rise, StepTransition } from './motion';
import { PosterFrame } from './poster-frame';
import { StickyActionBar } from './sticky-action-bar';
import { CHECKOUT_TRUST, TrustStrip } from './trust';

/**
 * Step 3 — review, and the moment inventory is actually taken.
 *
 * THIS IS THE FIRST WRITE IN THE FUNNEL. Everything before it was a selection in
 * a query string; `POST /bookings` takes a per-tier row lock, decrements
 * availability and starts a hold timer. Reserving here rather than on step 1 is
 * deliberate: holding stock while someone is still browsing tiers — or worse,
 * while they are creating an account — would take tickets off sale for people
 * who are ready to buy, and the hold would routinely expire before payment.
 *
 * It runs ONCE, on mount, guarded by a ref AND by a derived `Idempotency-Key`.
 * Neither alone is enough: the ref stops a double-invoked effect in development,
 * and the key stops a reload, a retry, or a Back-then-Forward from reserving a
 * second set of tickets. The backend dedupes on `(user, key)` and returns the
 * original booking, so every one of those paths converges on one reservation.
 *
 * If the reserve FAILS — a tier sold out while the account was being created —
 * that is said plainly, with a route back to the picker. It is the one failure
 * on this flow that is genuinely likely, and the one that is most infuriating to
 * meet as a generic error.
 *
 * ── THE EVENT ROW IS A ROW AT EVERY WIDTH ─────────────────────────────────
 *
 * The poster used to be `w-full` below `sm` with a 3:2 frame, so on a 390px
 * phone the first thing on the review screen was a 260px-tall box — and since
 * most events in this catalogue have no `poster_url`, that box was usually an
 * empty grey gradient. It is now a fixed portrait thumbnail (`aspect-portrait`,
 * the discovery language's 3:4) beside the details at every width, and a
 * `PosterFrame`, so the no-poster case shows the event's category tile instead
 * of a rectangle that reads as a failed image.
 */
export function ReviewStep() {
  const { event, selection, totals, booking, setBooking, setPaymentKeyId, setPaymentProvider } =
    useBooking();
  const { status, user } = useAuth();
  const router = useRouter();

  const [error, setError] = React.useState<{ message: string; recoverable: boolean } | null>(null);
  const [reserving, setReserving] = React.useState(false);
  const attempted = React.useRef(false);

  const query = selection.length ? `?${SELECTION_PARAM}=${serialiseSelection(selection)}` : '';
  /**
   * Back to the EVENT PAGE, not to a funnel step.
   *
   * This pointed at `/booking/{id}` — the old step 1 — so "Change" sent
   * somebody to a second copy of the picker rather than to the page they chose
   * on. That step is gone; the event page is where session, tier and quantity
   * are decided, beside the poster and the line-up that inform the choice.
   *
   * The selection rides along in the query string so the panel opens on what
   * they already had rather than resetting it.
   */
  const pickerHref = `/events/${event.id}${query}`;
  const payHref = booking
    ? `/booking/${event.id}/pay?${new URLSearchParams({
        [SELECTION_PARAM]: serialiseSelection(selection),
        booking: booking.id,
      }).toString()}`
    : `/booking/${event.id}/pay${query}`;

  // No session, no reservation: the booking belongs to a user.
  React.useEffect(() => {
    if (status === 'anonymous') router.replace(`/booking/${event.id}/login${query}`);
  }, [status, router, event.id, query]);

  // Nothing chosen (a bookmarked or hand-edited URL) — back to the picker,
  // which is the EVENT PAGE.
  //
  // This pointed at `/booking/{id}`, which was the picker step and is now a
  // redirect to this very screen — so an empty selection would have bounced
  // review -> entry -> review forever. The picker moved; this had to move with
  // it, and a redirect that lands on its own source is the specific way that
  // refactor goes wrong.
  React.useEffect(() => {
    if (status !== 'unknown' && !selection.length) router.replace(`/events/${event.id}`);
  }, [status, selection.length, router, event.id]);

  React.useEffect(() => {
    if (status !== 'authenticated' || !selection.length || booking || attempted.current) return;
    attempted.current = true;
    setReserving(true);

    void (async () => {
      try {
        const result = await createBooking(
          event.id,
          toBookingItems(selection),
          idempotencyKeyFor(event.id, selection),
        );
        setBooking(result.booking);
        setPaymentKeyId(result.payment.key_id);
        rememberKeyId(result.payment.key_id);
        // `provider` is newer than the hand-written response type in
        // lib/api/types.ts (which this file does not own); reading it as an
        // optional widening keeps the type honest without pretending the field
        // has always been there. An older backend simply reports nothing and
        // `resolveProvider` falls back to the real provider.
        const provider = (result.payment as { provider?: string }).provider ?? '';
        setPaymentProvider(provider);
        rememberProvider(provider);
        // Put the booking id in the URL. Context alone would lose it on a
        // refresh at the payment step — the one place someone is most likely to
        // reload, and the one place losing it means reserving a second time.
        const params = new URLSearchParams(window.location.search);
        params.set('booking', result.booking.id);
        window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
      } catch (thrown) {
        const apiError = thrown instanceof ApiError ? thrown : null;
        setError({
          message: apiError?.message ?? 'We could not hold these tickets. Please try again.',
          // Anything the user can fix by choosing differently.
          recoverable:
            apiError?.code === 'sold_out' ||
            apiError?.code === 'exceeds_max_per_order' ||
            apiError?.code === 'ticket_type_not_found',
        });
      } finally {
        setReserving(false);
      }
    })();
  }, [status, selection, booking, event.id, setBooking, setPaymentKeyId, setPaymentProvider]);

  const category = inferCategory(event);
  const directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${event.venue}, ${event.city}`,
  )}`;
  // `POST /bookings` returns a SUMMARY — no line items (only `GET /bookings/{id}`
  // carries them). So the lines come from the selection that was just sent,
  // which is the same data by construction. Reading `booking.items` alone
  // rendered an empty ticket list against the real backend.
  //
  // `unit_price` is the tier's EFFECTIVE price, not its face price: a line
  // synthesised at the face price showed a reserved order costing more than the
  // booking beside it actually did. `phase_name` comes along for the same reason
  // it exists on the server's own item — a lower number needs its label.
  const lines = booking?.items?.length
    ? booking.items
    : totals.lines.map((line) => ({
        ticket_type_id: line.tier.id,
        ticket_type_name: line.tier.name,
        quantity: line.quantity,
        unit_price: line.unitPrice,
        phase_name: line.phaseName,
      }));
  const total = booking?.total_amount ?? totals.total;

  if (error) {
    return (
      <StepTransition stepKey="review-error" className="flex flex-col gap-block">
        <div className="flex flex-col items-start gap-stack-lg rounded-xl border border-destructive-subtle bg-destructive-subtle p-card-lg">
          <AlertTriangle className="size-6 text-destructive-subtle-foreground" aria-hidden />
          <div className="flex flex-col gap-1">
            <h1 className="text-h3 text-destructive-subtle-foreground">
              {error.recoverable ? 'Those tickets just went' : 'We could not hold your tickets'}
            </h1>
            <p className="text-body-sm text-destructive-subtle-foreground">{error.message}</p>
          </div>
          <Button asChild size="lg" className={CTA_PILL_LG}>
            <Link href={pickerHref}>Choose different tickets</Link>
          </Button>
        </div>
      </StepTransition>
    );
  }

  if (reserving || !booking) {
    return (
      <StepTransition stepKey="review-loading" className="flex flex-col gap-block">
        <p
          role="status"
          className="inline-flex items-center gap-2 text-body-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Holding your tickets…
        </p>
        <div className="flex flex-col gap-stack-lg" aria-hidden>
          <div className="skeleton h-40 w-full rounded-xl" />
          <div className="skeleton h-32 w-full rounded-xl" />
          <div className="skeleton h-24 w-full rounded-xl" />
        </div>
      </StepTransition>
    );
  }

  return (
    <StepTransition stepKey="review" className="flex flex-col gap-section">
      <Rise>
        <header className="flex flex-col gap-stack">
          <h1 className="text-h2 md:text-h1">Review your booking</h1>
        </header>
      </Rise>

      <Rise index={2}>
        <section className="flex flex-col gap-stack-lg" aria-labelledby="event-heading">
          <h2 id="event-heading" className="text-h3">
            Event
          </h2>
          <div className="flex gap-stack-lg rounded-xl border border-border bg-surface p-card shadow-sm sm:gap-card lg:p-card-lg">
            <PosterFrame
              event={event}
              sizes="(min-width: 640px) 128px, 80px"
              className="aspect-portrait w-20 sm:w-32"
              iconClassName="size-10 sm:size-14"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {category ? (
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-caption text-muted-foreground">
                  <category.icon className="size-3" aria-hidden />
                  {category.label}
                </span>
              ) : null}
              <h3 className="text-body-lg font-semibold text-foreground">{event.title}</h3>
              <p className="flex items-center gap-2 text-body-sm text-muted-foreground">
                <CalendarDays className="size-4 shrink-0" aria-hidden />
                {formatEventDateLong(event.starts_at)} · {formatEventTime(event.starts_at)}
              </p>
              <p className="flex items-center gap-2 text-body-sm text-muted-foreground">
                <MapPin className="size-4 shrink-0" aria-hidden />
                {event.venue}, {event.city}
              </p>
              <p className="text-caption text-muted-foreground">
                Organised by {event.organization_name}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="outline" asChild className={PILL_MD}>
                  <Link href={`/events/${event.id}`}>View event</Link>
                </Button>
                <Button variant="ghost" asChild className={PILL_MD}>
                  <a href={directions} target="_blank" rel="noopener noreferrer">
                    <Navigation className="size-4" aria-hidden />
                    Directions
                    <span className="sr-only">(opens Google Maps in a new tab)</span>
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </Rise>

      <Rise index={3}>
        <section className="flex flex-col gap-stack-lg" aria-labelledby="tickets-heading">
          <div className="flex items-center justify-between gap-4">
            <h2 id="tickets-heading" className="text-h3">
              Tickets
            </h2>
            <Button variant="ghost" asChild className={PILL_MD}>
              <Link href={pickerHref}>
                <Pencil className="size-3.5" aria-hidden />
                Change
              </Link>
            </Button>
          </div>

          <div className="flex flex-col rounded-xl border border-border bg-surface shadow-sm">
            <ul className="flex flex-col divide-y divide-border">
              {lines.map((line) => (
                <li
                  key={line.ticket_type_id}
                  className="flex items-baseline justify-between gap-4 p-card"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body-sm font-medium text-foreground">
                      {line.ticket_type_name}
                    </span>
                    <span className="text-caption text-muted-foreground">
                      {formatFromPrice(line.unit_price)} × {line.quantity}
                      {/* The phase that priced it, named — otherwise the only
                          explanation on screen for a unit price below the tier's
                          list price is that something went wrong. */}
                      {line.phase_name ? ` · ${line.phase_name}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-body-sm tabular-nums text-foreground">
                    {formatFromPrice(line.unit_price * line.quantity)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex items-baseline justify-between gap-4 border-t border-border p-card">
              <span className="text-body font-semibold text-foreground">Total</span>
              <span className="text-h3 tabular-nums text-foreground">{formatFromPrice(total)}</span>
            </div>
            <p className="border-t border-border px-card py-3 text-caption text-muted-foreground">
              Includes a {formatFromPrice(booking.platform_fee)} platform fee. No booking surcharge,
              no taxes added at payment.
            </p>
          </div>
        </section>
      </Rise>

      {user ? (
        <Rise index={4}>
          <section className="flex flex-col gap-stack-lg" aria-labelledby="delivery-heading">
            <h2 id="delivery-heading" className="text-h3">
              Delivery
            </h2>
            <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-card shadow-sm lg:p-card-lg">
              <p className="text-body-sm text-foreground">{user.full_name || 'Your account'}</p>
              <p className="text-body-sm text-muted-foreground">{user.email}</p>
              <p className="mt-2 text-caption text-muted-foreground">
                QR tickets are emailed here the moment payment is confirmed, and are always in your
                account.
              </p>
            </div>
          </section>
        </Rise>
      ) : null}

      <Rise index={5}>
        <TrustStrip marks={CHECKOUT_TRUST} />
      </Rise>

      <div className="hidden justify-end lg:flex">
        <Button size="lg" asChild className={CTA_PILL_LG}>
          <Link href={payHref}>
            Proceed to payment
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </div>

      <StickyActionBar
        className={cn('lg:hidden')}
        total={total}
        caption={`${lines.reduce((sum, line) => sum + line.quantity, 0)} ticket(s) reserved`}
      >
        <Button size="lg" asChild className={cn(CTA_PILL_LG, 'shrink-0')}>
          <Link href={payHref}>
            Pay
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </StickyActionBar>
    </StepTransition>
  );
}
