'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, Ticket, TimerOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cancelBooking, createBooking, setBookingDonation } from '@/lib/api/bookings';
import { ApiError } from '@/lib/api/errors';
import type { Booking } from '@/lib/api/types';
import { attemptFor, bumpAttempt } from '@/lib/booking/attempt';
import { useAuth } from '@/lib/auth/auth-provider';
import { rememberProvider } from '@/lib/booking/payment-provider';
import { rememberKeyId } from '@/lib/booking/razorpay';
import {
  DONATION_MAX_MINOR,
  SELECTION_PARAM,
  idempotencyKeyFor,
  bookingItemsSignature,
  selectionSignature,
  serialiseSelection,
  toBookingItems,
} from '@/lib/booking/selection';
import { formatEventDate, formatEventTime, formatFromPrice } from '@/lib/discovery/format';
import { CTA_PILL_LG } from './cta';
import { useBooking } from './booking-context';
import { DonationCard, RuleHeading } from './donation-card';
import { FunnelScreen } from './funnel-shell';
import { HoldTimer } from './hold-timer';
import { Rise, StepTransition } from './motion';
import { PosterFrame } from './poster-frame';
import { PaymentSection, PayUsing } from './payment-section';
import { StickyActionBar } from './sticky-action-bar';
import { YourDetailsSheet } from './your-details-sheet';

/**
 * Screen 2 — review, pay, and the moment inventory is actually taken.
 *
 * THIS IS THE FIRST WRITE IN THE FUNNEL. Everything before it was a selection in
 * a query string; `POST /bookings` takes a per-tier row lock, decrements
 * availability and starts a hold timer. Reserving here rather than on screen 1
 * is deliberate: holding stock while someone is still browsing tiers — or worse,
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
 * that is said plainly, with a route back to the picker.
 *
 * ── AND IT IS THE LAST SCREEN ─────────────────────────────────────────────
 *
 * There used to be a fourth step at `/pay` whose entire job was to restate the
 * order this screen had just shown — the same lines, the same total, the same
 * fee note — and then offer a button. A whole navigation and a second chance to
 * abandon, in exchange for a summary somebody had already read. The button is on
 * the summary now. Nothing about the payment itself changed: no card UI on this
 * origin, the browser's success callback is not treated as proof, and the
 * confirmation screen still polls the BACKEND until it says `paid`.
 *
 * ── THE ORDER OF THE PAGE ─────────────────────────────────────────────────
 *
 * Countdown, event, tickets, payment summary, donation, ticket details, pay.
 * That is cost-of-missing-it, descending: the hold is the only thing here with a
 * deadline, the order is what is being bought, the total is what it costs — and
 * the donation sits AFTER the total rather than inside it, because an amount
 * nobody has agreed to has no business moving the number they are checking.
 */
export function ReviewStep() {
  const {
    event,
    selection,
    totals,
    booking,
    reservedFor,
    setBooking,
    setPaymentKeyId,
    setPaymentProvider,
  } = useBooking();
  const { status, user } = useAuth();
  const router = useRouter();

  const [error, setError] = React.useState<{ message: string; recoverable: boolean } | null>(null);
  const [reserving, setReserving] = React.useState(false);
  const attempted = React.useRef(false);
  /**
   * Bumped to re-run the reserve when nothing else in its dependencies moved.
   *
   * Declared up here because the effect's dependency array names it — see
   * `buyAgain`, where clearing an already-null booking is a no-op React bails
   * out of, so the press would otherwise do nothing at all.
   */
  const [reserveNonce, setReserveNonce] = React.useState(0);
  /** One re-reserve, ever. See the note in the effect: an ungated retry here
   *  would take inventory as fast as the network allows. */
  const retried = React.useRef(false);
  const [detailsOpen, setDetailsOpen] = React.useState(false);

  const query = selection.length ? `?${SELECTION_PARAM}=${serialiseSelection(selection)}` : '';
  /**
   * Back to the TICKET SCREEN — `/booking/{id}` — and this has now been both
   * ways, which is the point.
   *
   * It first pointed here, then was moved to the event page when the picker
   * lived there, and the picker has since moved BACK to its own screen. This
   * link was not moved back with it, so "Change" walked out of the funnel and
   * onto the standalone event page — the one surface this flow is not supposed
   * to touch on a phone. The selection rides along in the query, so the picker
   * opens on what was already chosen.
   */
  const pickerHref = `/booking/${event.id}${query}`;

  // No session, no reservation: the booking belongs to a user. Back to the
  // PICKER, which is where the sign-in sheet lives now.
  React.useEffect(() => {
    if (status === 'anonymous') router.replace(pickerHref);
  }, [status, router, pickerHref]);

  // Nothing chosen (a bookmarked or hand-edited URL) — back to the picker.
  React.useEffect(() => {
    if (status !== 'unknown' && !selection.length) router.replace(pickerHref);
  }, [status, selection.length, router, pickerHref]);

  /**
   * ── THE BOOKING IN CONTEXT MAY DESCRIBE A DIFFERENT ORDER ──────────────
   *
   * `BookingProvider` lives in the checkout LAYOUT, so a reserved booking
   * survives the trip to the picker and back. The reserve effect below then
   * short-circuits on `|| booking`, and the order lines render from
   * `booking.items` — so pressing "Change", picking a different quantity and
   * coming forward showed, and charged for, the ORIGINAL selection while the
   * URL and the picker both said otherwise. No request, no error, no clue.
   *
   * The stale hold is CANCELLED rather than abandoned. Leaving it would hold
   * inventory the customer is no longer buying for the rest of its ten
   * minutes, and a person who changes their mind twice would sit on three
   * holds at once.
   *
   * The cancel is fire-and-forget: a 409 means it is already gone, which is
   * the outcome we wanted. `stale` guards against re-entry, and clearing the
   * booking re-arms the reserve below for the selection that is actually on
   * screen.
   */
  const staleBooking = React.useMemo(() => {
    if (!booking || !selection.length) return false;
    const current = selectionSignature(selection);
    // PRIMARY: the signature the client recorded when it sent the reserve. It
    // cannot be switched off by a serializer change, which is what happened to
    // the items comparison below — `POST /bookings` returned no items, so this
    // guard evaluated false for every booking and the screen rendered a hold
    // for one order beside the line items of another.
    if (reservedFor) return reservedFor !== current;
    // FALLBACK for a booking adopted from elsewhere (the confirmation screen
    // publishes the one it polled). Still worth having: it catches a replay
    // whose lines genuinely differ.
    if (booking.items?.length) return bookingItemsSignature(booking.items) !== current;
    // Neither available: do NOT guess. Cancelling a hold on a hunch is worse
    // than showing one, and the picker cancels anything left over anyway.
    return false;
  }, [booking, reservedFor, selection]);
  const clearing = React.useRef(false);

  React.useEffect(() => {
    if (!staleBooking || !booking || clearing.current) return;
    clearing.current = true;
    const dead = booking;
    void (async () => {
      await cancelBooking(dead.id).catch(() => undefined);
      attempted.current = false;
      setBooking(null);
      clearing.current = false;
    })();
  }, [staleBooking, booking, setBooking]);

  /**
   * ── A RESERVE MUST COME BACK WITH A HOLD YOU CAN PAY FOR ────────────────
   *
   * It did not check, and that is how the worst bug on this screen stayed
   * invisible. `POST /bookings` can legitimately answer with a booking that is
   * NOT a live hold — the idempotency key replayed an earlier attempt — and the
   * screen accepted whatever came back. A settled booking then rendered with a
   * live Pay button over a stale total, and pressing it opened the provider's
   * checkout against an order that had already been captured.
   *
   * `payable` is the one question worth asking, and it is asked of the row
   * itself rather than of `status` alone: a RESERVED booking whose deadline has
   * passed is not payable either, and the sweeper runs on a schedule so that
   * state is genuinely reachable.
   */
  const payable = (row: Booking): boolean =>
    row.status === 'reserved' &&
    Boolean(row.hold_expires_at) &&
    Date.parse(row.hold_expires_at as string) > Date.now();

  React.useEffect(() => {
    if (status !== 'authenticated' || !selection.length || booking || attempted.current) return;
    attempted.current = true;
    setReserving(true);

    void (async () => {
      try {
        const result = await createBooking(
          event.id,
          toBookingItems(selection),
          idempotencyKeyFor(event.id, selection, attemptFor(event.id, selection)),
        );

        // ── PREVIOUS PURCHASE DETECTED ──────────────────────────────────
        //
        // If the server answered with an already-settled booking, this key
        // spoke for an earlier completed purchase. Never block with
        // "You already have these tickets" — bump the attempt to generate a
        // new idempotency key and immediately reserve a brand new booking.
        if (result.booking.status === 'paid') {
          bumpAttempt(event.id, selection);
          attempted.current = false;
          setBooking(null);
          setReserving(false);
          setReserveNonce((n) => n + 1);
          return;
        }

        // ── REPLAYED SOMETHING THAT HAS ENDED ───────────────────────────
        //
        // Cancelled, expired, or reserved past its deadline. The previous
        // attempt is over, so this is a new one: bump the attempt (which
        // changes the key) and let the effect run again. ONCE — `retried`
        // guards it, because a loop here would reserve inventory as fast as
        // the network allows.
        if (!payable(result.booking)) {
          if (!retried.current) {
            retried.current = true;
            bumpAttempt(event.id, selection);
            attempted.current = false;
            setBooking(null);
            setReserving(false);
            return;
          }
          setError({
            message: 'We could not hold these tickets. Please choose them again.',
            recoverable: true,
          });
          return;
        }

        // The signature goes in WITH the booking, from the same `selection` this
        // request was built from — so the pair cannot describe two orders.
        setBooking(result.booking, selectionSignature(selection));
        setPaymentKeyId(result.payment.key_id);
        rememberKeyId(result.payment.key_id);
        // `provider` is newer than the hand-written response type in
        // lib/api/types.ts (which this file does not own); reading it as an
        // optional widening keeps the type honest without pretending the field
        // has always been there.
        const provider = (result.payment as { provider?: string }).provider ?? '';
        setPaymentProvider(provider);
        rememberProvider(provider);
        // Put the booking id in the URL. Context alone would lose it on a
        // refresh — the one place someone is most likely to reload, and the one
        // place losing it means reserving a second time.
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
  }, [
    status,
    selection,
    booking,
    event.id,
    reserveNonce,
    router,
    setBooking,
    setPaymentKeyId,
    setPaymentProvider,
  ]);

  // ── THE DONATION ────────────────────────────────────────────────────────
  //
  // Written to the BOOKING, never held only in local state, because
  // `total_amount` is the number the payment order is created for AND the number
  // the webhook amount-checks against. A donation that existed only on screen
  // would put one figure on the pay button and charge another — and the check
  // would then refuse a payment that was in every other sense fine.
  //
  // The write does not touch the reservation (see `set_donation`), so changing
  // one's mind about ₹15 can never cost somebody their seats.
  /**
   * ── WHY THIS IS OPTIMISTIC ──────────────────────────────────────────────
   *
   * It used to read the amount straight off `booking.donation` and write on
   * every press. Two things went wrong with that, and together they are why
   * the total moved sometimes and not others:
   *
   * 1. **The toggle read a stale value.** `choose()` decides between "set" and
   *    "clear" by comparing against the CURRENT value. Between the press and
   *    the response that value is still the old one, so a second press inside
   *    the round trip decided from the wrong state — the classic
   *    read-modify-write the ticket stepper was fixed for on this same funnel.
   *
   * 2. **A rejected write left no trace.** If the request failed — an older
   *    backend with no donation endpoint, a lapsed hold, a flaky connection —
   *    the catch swallowed it and the chip simply sprang back with nothing
   *    said. Indistinguishable from a tap that missed.
   *
   * So the chosen amount is LOCAL state, applied immediately, and the server
   * response reconciles it. `pending` still disables the row, so there is only
   * ever one write in flight; a failure restores the last known-good value AND
   * says so, because an amount on this screen that disagrees with what will be
   * charged is the one thing that must never happen quietly.
   */
  /**
   * ── THE HOLD LAPSED WHILE THIS SCREEN WAS OPEN ──────────────────────────
   *
   * Set by `HoldTimer`'s `onExpire`. Until it existed, the countdown reaching
   * zero changed a colour and nothing else: the band read "these tickets have
   * been released" while the bar underneath still said `₹998 | Pay`, live.
   *
   * The screen SWAPS rather than opening a dialog. A modal can be dismissed —
   * Escape, a backdrop tap — and dismissing it would leave the payable screen
   * sitting underneath, which is the one state that must not be reachable. A
   * state swap has no such hole, and it reuses the shape this screen already
   * has for a failed reserve, so there is one language for "those tickets are
   * gone" rather than two.
   *
   * It does NOT navigate on a timer. Somebody may be mid-edit — a custom
   * donation, the details sheet — and a checkout that moves on its own is
   * indistinguishable from a crash. Ticketmaster, BookMyShow and Eventbrite
   * all land the same way: change the screen, wait for a press.
   */
  const [holdExpired, setHoldExpired] = React.useState(false);
  /**
   * The hold ran out. RELEASE IT, then swap the screen.
   */
  const expireHold = React.useCallback(() => {
    const dead = booking;
    bumpAttempt(event.id, selection);
    setHoldExpired(true);
    setOptimisticDonation(null);
    setBooking(null);
    if (dead) void cancelBooking(dead.id).catch(() => undefined);
  }, [booking, event.id, selection, setBooking]);

  const [retrying, setRetrying] = React.useState(false);
  const retryHold = React.useCallback(() => {
    const dead = booking;
    setRetrying(true);
    bumpAttempt(event.id, selection);
    void (async () => {
      if (dead) await cancelBooking(dead.id).catch(() => undefined);
      setHoldExpired(false);
      setError(null);
      setOptimisticDonation(null);
      attempted.current = false;
      setBooking(null);
      setReserveNonce((n) => n + 1);
      setRetrying(false);
    })();
  }, [booking, event.id, selection, setBooking]);
  const [donationPending, setDonationPending] = React.useState(false);
  const [donationError, setDonationError] = React.useState<string | null>(null);
  const [optimisticDonation, setOptimisticDonation] = React.useState<number | null>(null);
  const serverDonation = booking?.donation ?? 0;
  const donation = optimisticDonation ?? serverDonation;

  const changeDonation = (minor: number) => {
    if (!booking || minor === donation || donationPending) return;
    const previous = donation;
    setOptimisticDonation(minor);
    setDonationError(null);
    setDonationPending(true);
    void (async () => {
      try {
        const updated = await setBookingDonation(booking.id, minor);
        setBooking(updated);
        // Hand authority back to the server's number. If the two agree this is
        // invisible; if they do not, the server wins — it is the amount that
        // will actually be charged.
        setOptimisticDonation(null);
      } catch (thrown) {
        setOptimisticDonation(previous === serverDonation ? null : previous);
        setDonationError(
          thrown instanceof ApiError
            ? thrown.message
            : 'We could not add that just now. Nothing has changed.',
        );
      } finally {
        setDonationPending(false);
      }
    })();
  };

  // `POST /bookings` returns a SUMMARY — no line items (only `GET /bookings/{id}`
  // carries them). So the lines come from the selection that was just sent,
  // which is the same data by construction. `unit_price` is the tier's EFFECTIVE
  // price: a line synthesised at the face price showed a reserved order costing
  // more than the booking beside it actually did.
  const lines = booking?.items?.length
    ? booking.items
    : totals.lines.map((line) => ({
        ticket_type_id: line.tier.id,
        ticket_type_name: line.tier.name,
        quantity: line.quantity,
        unit_price: line.unitPrice,
        phase_name: line.phaseName,
      }));
  const total = booking?.total_amount ?? totals.grandTotal;
  const fee = booking?.platform_fee ?? totals.platformFee;
  /**
   * ── THE SUMMARY HAS TO ADD UP ───────────────────────────────────────────
   *
   * It did not, and the screenshot of it is the reason this comment exists:
   * "Order amount ₹1,995 / Fees ₹3.99 / Donation ₹5 / Grand total ₹407.99".
   *
   * Both numbers were computed correctly from different sources. `total` came
   * from the BOOKING — the price the row lock actually settled on, with a live
   * sale phase applied. `orderAmount` summed `lines`, which fell back to the
   * SELECTION whenever `booking.items` was absent — and it was always absent,
   * because `POST /bookings` returned the summary serializer. So the order
   * amount was an estimate off the cached tier payload and the total was the
   * truth, and a phase between the two made them disagree by a factor of five.
   *
   * Two changes, and both were needed. The endpoint returns its line items now,
   * so `lines` is authoritative. And once a booking exists the order amount is
   * DERIVED FROM THE SAME ROW as the total rather than re-summed from anything
   * — `total_amount` contains the fee and the donation, so the subtotal is a
   * subtraction, and three numbers that come from one row cannot fail to add up
   * however the lock priced them.
   */
  const orderAmount = booking
    ? booking.total_amount - booking.platform_fee - booking.donation
    : lines.reduce((sum, line) => sum + line.unit_price * line.quantity, 0);
  const ticketCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  if (error) {
    return (
      <FunnelScreen title="Review your booking">
        {/* Drawn like the expired state next door — centred, the alarm colour
            confined to the icon — because a full-bleed red slab at the top of
            an empty screen reads as a crash rather than as a tier selling out
            while somebody was deciding. */}
        <StepTransition
          stepKey="review-error"
          className="flex flex-1 flex-col items-center justify-center gap-stack-lg px-2 py-10 text-center"
        >
          <span
            aria-hidden
            className="inline-flex size-16 items-center justify-center rounded-full bg-destructive-subtle text-destructive"
          >
            <AlertTriangle className="size-7" />
          </span>
          <div className="flex flex-col gap-2">
            <h2 className="text-h3 text-foreground">
              {error.recoverable ? 'Those tickets just went' : 'We could not hold your tickets'}
            </h2>
            <p className="mx-auto max-w-sm text-body-sm text-muted-foreground">{error.message}</p>
          </div>
          <div className="flex w-full max-w-sm flex-col gap-2">
            {/* A SECOND ATTEMPT, which this screen did not offer.
                Every reason it can fail is transient — a tier that was
                momentarily oversubscribed, a request that did not land — and
                sending somebody back to the picker to re-choose what they had
                already chosen is a worse answer to "try again" than a button
                that tries again. */}
            <Button size="lg" className={CTA_PILL_LG} onClick={retryHold} disabled={retrying}>
              {retrying ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Trying again
                </>
              ) : (
                'Try again'
              )}
            </Button>
            <Button asChild variant="ghost" size="lg" className="w-full">
              <Link href={pickerHref}>Choose different tickets</Link>
            </Button>
          </div>
        </StepTransition>
      </FunnelScreen>
    );
  }

  if (holdExpired) {
    return (
      <FunnelScreen title="Review your booking">
        {/* ── A RECOVERABLE STATE, DRAWN AS ONE ──────────────────────────
            This was a full-bleed `destructive-subtle` slab pinned to the top
            of an otherwise empty screen: the loudest possible treatment, at
            the top of nothing, for a situation that is usually one press from
            fixed and that the reader did not cause. It reads as a failure
            page.

            It is centred in the space it has now, and the alarm colour is
            confined to the ICON — a single red mark that says which kind of
            state this is — while the words sit on the ordinary surface where
            everything else on this funnel sits. `justify-center` with `flex-1`
            rather than a fixed offset, so it is centred on a phone and does
            not float oddly on a tall desktop viewport. */}
        <StepTransition
          stepKey="review-expired"
          className="flex flex-1 flex-col items-center justify-center gap-stack-lg px-2 py-10 text-center"
        >
          <span
            aria-hidden
            className="inline-flex size-16 items-center justify-center rounded-full bg-destructive-subtle text-destructive"
          >
            <TimerOff className="size-7" />
          </span>
          <div className="flex flex-col gap-2">
            <h2 className="text-h3 text-foreground">Your hold has expired</h2>
            <p className="mx-auto max-w-sm text-body-sm text-muted-foreground">
              These tickets went back on sale so somebody else could buy them.{' '}
              <strong className="font-semibold text-foreground">Nothing has been charged.</strong>{' '}
              They may still be available.
            </p>
          </div>
          <div className="flex w-full max-w-sm flex-col gap-2">
            <Button size="lg" className={CTA_PILL_LG} onClick={retryHold} disabled={retrying}>
              {retrying ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Getting them back
                </>
              ) : (
                'Get these tickets again'
              )}
            </Button>
            {/* The way out: starts completely fresh with an empty cart. */}
            <Button asChild variant="ghost" size="lg" className="w-full">
              <Link href={`/booking/${event.id}`}>Choose different tickets</Link>
            </Button>
          </div>
        </StepTransition>
      </FunnelScreen>
    );
  }

  if (reserving || !booking) {
    return (
      <FunnelScreen title="Review your booking">
        <StepTransition stepKey="review-loading" className="flex flex-col gap-4">
          <p
            role="status"
            className="inline-flex items-center gap-2 text-body-sm text-muted-foreground"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Holding your tickets…
          </p>
          <div className="flex flex-col gap-4" aria-hidden>
            <div className="skeleton h-20 w-full rounded-2xl" />
            <div className="skeleton h-44 w-full rounded-2xl" />
            <div className="skeleton h-32 w-full rounded-2xl" />
          </div>
        </StepTransition>
      </FunnelScreen>
    );
  }

  return (
    <FunnelScreen
      title="Review your booking"
      banner={
        // ── SHOWN WHENEVER THERE IS A HOLD TO COUNT ────────────────────────
        //
        // The condition was `status === 'reserved' && hold_expires_at`. The
        // status half is the fragile one: it is a string off the wire, and ANY
        // value the client did not anticipate — a backend that has not shipped
        // the field, a serializer that renames it, a deployment mid-rollout —
        // silently removes the countdown with nothing on screen saying why.
        // That is exactly how a timer gets reported as missing.
        //
        // What actually matters is whether there is a deadline to count and
        // whether it has already been settled. `hold_expires_at` answers the
        // first; `status !== 'paid'` answers the second, and it fails SAFE:
        // an unrecognised status shows the countdown rather than hiding it.
        // The one case that must never show it is a PAID booking, whose
        // timestamp is a historical fact about a hold that was honoured —
        // counting down over issued tickets and then announcing they had been
        // released would be the most alarming sentence on the least
        // appropriate screen.
        booking.hold_expires_at && booking.status !== 'paid' ? (
          <HoldTimer
            /* KEYED ON THE DEADLINE. `HoldTimer` re-arms on a changed `target`,
               but the surrounding component keeps its `firedRef` across a
               prop change — so a NEW booking created after an expiry inherited
               a timer that had already announced, and its countdown could not
               fire again. A key remounts it, which is the only way to be sure a
               fresh hold gets a fresh timer. */
            key={booking.hold_expires_at}
            expiresAt={booking.hold_expires_at}
            variant="bar"
            onExpire={expireHold}
          />
        ) : undefined
      }
    >
      <StepTransition stepKey="review" className="flex flex-col gap-4">
        {/* ── THE EVENT, ONCE ─────────────────────────────────────────────
            A thumbnail and two lines. The full card — organiser, View event,
            Directions — was here AND in the summary card above it, so the same
            event was drawn twice on one screen. Those controls are ways OUT of a
            checkout; they belong on the event page, one press of Back away. */}
        <Rise>
          <div className="flex items-center gap-3">
            <PosterFrame
              event={event}
              sizes="64px"
              className="aspect-square w-16 shrink-0 rounded-xl"
              iconClassName="size-7"
            />
            <div className="flex min-w-0 flex-col">
              <h2 className="truncate text-body-lg font-semibold text-foreground">{event.title}</h2>
              <p className="truncate text-body-sm text-muted-foreground">
                {event.venue}, {event.city}
              </p>
            </div>
          </div>
        </Rise>

        {/* ── WHAT IS BEING BOUGHT ────────────────────────────────────────── */}
        <Rise index={1}>
          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="flex items-baseline gap-2 px-card py-card">
              <span className="text-body font-semibold text-foreground">
                {formatEventDate(event.starts_at)}
              </span>
              <span aria-hidden className="text-border-strong">
                |
              </span>
              <span className="text-body font-semibold text-foreground">
                {formatEventTime(event.starts_at)}
              </span>
            </div>

            <div className="border-t border-border px-card pt-card">
              <p className="text-caption text-muted-foreground">
                {ticketCount} {ticketCount === 1 ? 'ticket' : 'tickets'}
              </p>
            </div>

            <ul className="flex flex-col px-card pb-card pt-2">
              {lines.map((line) => (
                <li
                  key={line.ticket_type_id}
                  className="flex items-start justify-between gap-4 py-2"
                >
                  <div className="flex min-w-0 flex-col items-start gap-0.5">
                    <span className="text-body text-foreground">
                      {line.quantity} x {line.ticket_type_name}
                    </span>
                    {/* "Change", not "Remove". Dropping one line of a LIVE hold
                        means cancelling the reservation and re-reserving the
                        rest — a new booking id and a fresh countdown. The picker
                        does exactly that, with the selection already loaded, in
                        one press: a second write path for the same operation
                        would be a second place for it to go wrong, on the money
                        path, for no gain. */}
                    <Link
                      href={pickerHref}
                      className="text-caption text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
                    >
                      Change
                    </Link>
                    {/* The phase that priced it, named — otherwise the only
                        explanation on screen for a unit price below the tier's
                        list price is that something went wrong. */}
                    {line.phase_name ? (
                      <span className="text-caption text-muted-foreground">{line.phase_name}</span>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-body tabular-nums text-foreground">
                    {formatFromPrice(line.unit_price * line.quantity)}
                  </span>
                </li>
              ))}
            </ul>

            <p className="flex items-center gap-2.5 border-t border-border px-card py-3 text-body-sm text-muted-foreground">
              <Ticket className="size-4 shrink-0" aria-hidden />
              M-Ticket: entry using the QR code in your account
            </p>
          </div>
        </Rise>

        {/* ── WHAT IT COSTS ───────────────────────────────────────────────── */}
        <Rise index={2}>
          <RuleHeading>Payment summary</RuleHeading>
        </Rise>
        <Rise index={2}>
          <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="flex flex-col gap-2 px-card py-card">
              <SummaryRow label="Order amount" value={orderAmount} />
              {/* ── THE FEE IS ITS OWN LINE, AND IT IS ADDED ──────────────
                  This screen used to state the opposite in a caption:
                  "includes a ₹0.10 platform fee, no booking surcharge". True of
                  a flat fee DEDUCTED from the organizer's share. It is 1%
                  charged on top now, so it is a row between the order amount and
                  the total — a charge the customer pays that is not on its own
                  line is the definition of a hidden fee. */}
              <SummaryRow label="Fees and charges" value={fee} />
              {donation > 0 ? <SummaryRow label="Donation" value={donation} /> : null}
            </div>
            <div className="flex items-baseline justify-between gap-4 border-t border-border px-card py-card">
              <span className="text-body font-semibold text-foreground">Grand total</span>
              {/* Summed from the three rows ABOVE it, not read separately off
                  the booking. While a donation write is in flight the row shows
                  the chosen amount and `booking.total_amount` is still the old
                  one — read separately, the summary stops adding up for the
                  length of a round trip on the screen where that matters most.
                  Once the write lands the two are the same number by
                  construction: `total_amount` IS subtotal + fee + donation. */}
              <span className="text-h4 tabular-nums text-foreground">
                {formatFromPrice(booking ? orderAmount + fee + donation : total)}
              </span>
            </div>
          </div>
        </Rise>

        {/* ── AN OFFER, AFTER THE TOTAL ───────────────────────────────────── */}
        <Rise index={3}>
          <DonationCard
            value={donation}
            onChange={changeDonation}
            disabled={donationPending}
            maxMinor={DONATION_MAX_MINOR}
            error={donationError}
          />
        </Rise>

        {/* ── WHO IT IS FOR ───────────────────────────────────────────────── */}
        {user ? (
          <>
            <Rise index={4}>
              <RuleHeading>Ticket details</RuleHeading>
            </Rise>
            <Rise index={4}>
              <div className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-card">
                <div className="flex items-start justify-between gap-4">
                  <p className="text-body font-semibold text-foreground">
                    {user.full_name || 'Your account'}
                  </p>
                  {/* The ticket is issued in this name. Without an edit here the
                      only way to correct it was to leave the funnel for account
                      settings and start again — losing the inventory hold. */}
                  <button
                    type="button"
                    onClick={() => setDetailsOpen(true)}
                    className="shrink-0 text-body-sm font-semibold text-foreground underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Edit
                  </button>
                </div>
                {user.phone ? (
                  <p className="text-body-sm text-muted-foreground">{user.phone}</p>
                ) : null}
                <p className="text-body-sm text-muted-foreground">{user.email}</p>
                <p className="mt-2 border-t border-border pt-3 text-caption text-muted-foreground">
                  QR tickets are emailed here the moment payment is confirmed, and are always in
                  your account.
                </p>
              </div>
            </Rise>
          </>
        ) : null}
        {/* ── WHY THE BUTTON DOES WHAT IT DOES ────────────────────────────
            The action is in the bar; its explanation is here, where there is
            room to read it. Rendering only the bar left a deployment with no
            provider showing a button labelled "Simulate" and nothing at all
            saying why — the exact thing `payment-section` exists to prevent. */}
        <Rise index={5}>
          <PaymentSection event={event} active={booking} layout="notice" />
        </Rise>
      </StepTransition>

      <StickyActionBar total={total} caption="Total" leading={<PayUsing />}>
        <PaymentSection event={event} active={booking} layout="compact" pending={donationPending} />
      </StickyActionBar>

      <YourDetailsSheet open={detailsOpen} onOpenChange={setDetailsOpen} />
    </FunnelScreen>
  );
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-body-sm text-muted-foreground">{label}</span>
      <span className="text-body-sm tabular-nums text-foreground">{formatFromPrice(value)}</span>
    </div>
  );
}
