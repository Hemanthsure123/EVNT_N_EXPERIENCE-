'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FlaskConical, Info, Lock, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-provider';
import { ApiError } from '@/lib/api/errors';
import { simulatePayment, verifyPayment } from '@/lib/api/payments';
import { resolveProvider } from '@/lib/booking/payment-provider';
import { openCheckout, resolveKeyId } from '@/lib/booking/razorpay';
import { formatFromPrice } from '@/lib/discovery/format';
import type { Booking, EventDetail } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';
import { CTA_PILL_LG, PILL } from './cta';
import { useBooking } from './booking-context';

/**
 * Paying, ON the review screen.
 *
 * ── WHY THERE IS NO LONGER A PAYMENT PAGE ─────────────────────────────────
 *
 * There used to be a fourth step at `/pay` whose entire job was to restate the
 * order — the same lines, the same total, the same platform-fee note the review
 * screen had shown one press earlier — and then offer a button. A whole
 * navigation, a whole re-render, and a second chance to abandon, in exchange
 * for showing somebody a summary they had just read.
 *
 * So the button moved to the summary. Everything else about the payment is
 * unchanged, including every guard: no card UI on this origin, the browser's
 * success callback is not proof, and the confirmation screen still polls the
 * BACKEND until it says `paid`.
 *
 * ── THE TRUST MODEL, WHICH DID NOT MOVE ───────────────────────────────────
 *
 * Razorpay's `onSuccess` fires in this page, and a page can be lied to. All it
 * is permitted to do is forward the payment id to `POST /payments/verify`,
 * which makes the SERVER ask Razorpay whether that payment was captured, for
 * which order, for how much. That is the same class of evidence as the webhook
 * — a fact stated by the provider over an authenticated channel — obtained by
 * pulling rather than waiting to be pushed. It is best-effort and idempotent:
 * it writes the webhook's own ledger key, so whichever arrives first does the
 * work and the other is a no-op. And if BOTH are lost,
 * `payments.reconcile_pending` finds it server-side within two minutes.
 *
 * ── THREE STATES, AND THE SERVER DECIDES WHICH ────────────────────────────
 *
 *   razorpay + a key  -> the real checkout.
 *   fake              -> a plainly-labelled SIMULATED payment.
 *   razorpay, no key  -> "payment provider not configured", and it stops there.
 *
 * The provider is whatever `POST /bookings` REPORTED, never inferred from
 * whether a public key happens to be a non-empty string: a leftover
 * `RAZORPAY_KEY_ID` beside `PAYMENTS_BACKEND=fake` used to render a live
 * "Pay ₹1,200" button that opened Razorpay with a `fake_order_…` id, which
 * Razorpay rejects only after the customer has committed to paying.
 */
export function PaymentSection({
  event,
  active,
  layout,
}: {
  event: EventDetail;
  active: Booking;
  /** `full` is the desktop block under the summary; `compact` is the sticky
   *  mobile bar's button, which is the same action with no explanatory copy. */
  layout: 'full' | 'compact';
}) {
  const { paymentKeyId, paymentProvider } = useBooking();
  const { user } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const keyId = resolveKeyId(paymentKeyId);
  const provider = resolveProvider(paymentProvider);
  const total = active.total_amount;
  const isDemo = provider === 'fake';

  const pay = async () => {
    if (!active.payment_order_id) {
      setError('This order has no payment reference. Please start the booking again.');
      return;
    }
    setBusy(true);
    setError(null);
    await openCheckout({
      keyId,
      orderId: active.payment_order_id,
      amountMinor: active.total_amount,
      currency: 'INR',
      eventTitle: event.title,
      customer: { name: user?.full_name, email: user?.email },
      onSuccess: (response) => {
        // STILL not marking anything paid here — see the note above. This
        // hands the backend an ID and asks it to go and check with Razorpay
        // itself; the answer that matters comes from Razorpay, not from this
        // callback. The confirmation screen polls the booking either way, so
        // a failure here costs nothing: the webhook (where one can reach us)
        // gets there on its own, and the poll keeps waiting until it does.
        void verifyPayment(response.razorpay_payment_id).catch(() => {
          /* Best-effort nudge. Never block the redirect on it — the poll and
             the webhook are both still running. */
        });
        // The id travels to the confirmation screen so its poll can re-ask if
        // this one request was lost. A single dropped nudge should not be the
        // difference between a ticket and nothing on a deployment where the
        // webhook cannot reach us.
        router.replace(
          `/booking/${event.id}/confirmation?booking=${active.id}&pid=${encodeURIComponent(
            response.razorpay_payment_id,
          )}`,
        );
      },
      onDismiss: () => {
        setBusy(false);
        setError(null);
      },
      onFailure: (message) => {
        setBusy(false);
        setError(message);
      },
    });
  };

  const simulate = async () => {
    setBusy(true);
    setError(null);
    try {
      // The server tells the fake provider money arrived and then confirms
      // through the ordinary path. Its answer is the provider's, not ours — a
      // hold that lapsed mid-demo comes back as a refusal, not a ticket.
      await simulatePayment(active.id);
      router.replace(`/booking/${event.id}/confirmation?booking=${active.id}`);
    } catch (thrown) {
      setBusy(false);
      setError(
        thrown instanceof ApiError
          ? thrown.message
          : 'The simulated payment did not complete. Nothing was charged — nothing could be.',
      );
    }
  };


  const errorBlock = error ? (
    <p
      role="alert"
      className="rounded-xl border border-destructive-subtle bg-destructive-subtle p-card text-body-sm text-destructive-subtle-foreground"
    >
      {error}
    </p>
  ) : null;

  // THE MOBILE BAR CARRIES THE ACTION AND NOTHING ELSE. The sticky bar is
  // ~72px of a phone; an explanation of demo mode does not fit in it and does
  // not belong there — the full block above it already says all of that, and
  // the bar is scrolled past it, not instead of it.
  if (layout === 'compact') {
    if (isDemo) {
      return (
        <Button
          variant="outline"
          size="lg"
          onClick={() => void simulate()}
          loading={busy}
          className={cn(PILL, 'h-control-lg shrink-0')}
        >
          Simulate
        </Button>
      );
    }
    if (!keyId) return null;
    return (
      <Button
        size="lg"
        onClick={() => void pay()}
        loading={busy}
        className={cn(CTA_PILL_LG, 'shrink-0')}
      >
        <Lock className="size-4" aria-hidden />
        Pay
      </Button>
    );
  }

  if (isDemo) {
    return (
      <section className="flex flex-col gap-stack-lg" aria-labelledby="pay-heading">
        <h2 id="pay-heading" className="text-h3">
          Payment
        </h2>
        {errorBlock}
        {/* DEMO MODE, SAID OUT LOUD. No provider branding, no lock icon and no
            filled pill — every one of those is a claim this control cannot
            make. What IS real is everything after the press: the backend
            confirms through the same path a Razorpay payment takes, and a
            genuine ticket with a genuine signed QR comes out. */}
        <div className="flex flex-col gap-stack-lg rounded-xl border border-dashed border-border-strong bg-sunken p-card-lg">
          <p className="inline-flex items-center gap-2 text-body-sm font-medium text-foreground">
            <FlaskConical className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            Demo mode — this payment is simulated
          </p>
          <p className="text-body-sm text-muted-foreground">
            This deployment has no payment provider connected, so no card is charged and no money
            moves. Continuing records a simulated payment against order{' '}
            <span className="font-mono text-caption text-foreground">
              {active.payment_order_id}
            </span>{' '}
            and issues real tickets with real QR codes, through exactly the same confirmation the
            live provider would trigger.
          </p>
          <div className="flex flex-col items-start gap-3">
            <Button
              variant="outline"
              size="lg"
              onClick={() => void simulate()}
              loading={busy}
              className={cn(PILL, 'h-control-lg')}
            >
              Simulate paying {formatFromPrice(total)}
            </Button>
            <p className="text-caption text-muted-foreground">
              Connect Razorpay (<span className="font-mono">PAYMENTS_BACKEND=razorpay</span>) to
              take a real payment. This control does not exist when one is configured.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (!keyId) {
    return (
      <section className="flex flex-col gap-stack-lg" aria-labelledby="pay-heading">
        <h2 id="pay-heading" className="text-h3">
          Payment
        </h2>
        {errorBlock}
        {/* Razorpay is the configured provider but no public key reached the
            browser. Everything up to the handoff is real — the booking exists,
            inventory is held, the order id below is the one the backend
            created. What cannot happen is opening a checkout, and that is said
            rather than worked around. */}
        <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-sunken p-card-lg">
          <p className="inline-flex items-center gap-2 text-body-sm font-medium text-foreground">
            <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            Payment provider not configured
          </p>
          <p className="text-body-sm text-muted-foreground">
            Your tickets are reserved and the order was created — order{' '}
            <span className="font-mono text-caption text-foreground">
              {active.payment_order_id}
            </span>
            . Razorpay Checkout opens once a live key is set (
            <span className="font-mono text-caption">RAZORPAY_KEY_ID</span> on the backend, or{' '}
            <span className="font-mono text-caption">NEXT_PUBLIC_RAZORPAY_KEY_ID</span> here).
          </p>
          <p className="text-caption text-muted-foreground">
            Nothing is charged and no payment is simulated — a confirmation screen for money that
            never moved is the one thing a checkout must never show.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-stack-lg" aria-labelledby="pay-heading">
      <h2 id="pay-heading" className="text-h3">
        Payment
      </h2>
      {errorBlock}
      <div className="flex flex-col gap-stack rounded-xl border border-border bg-surface p-card-lg shadow-sm">
        <p className="text-body-sm text-muted-foreground">
          Card details are entered on Razorpay&rsquo;s encrypted checkout — they never touch
          Curatix. You will be returned here the moment it completes.
        </p>
        <div className="flex flex-col items-start gap-3">
          <Button
            size="lg"
            onClick={() => void pay()}
            loading={busy}
            className={cn(CTA_PILL_LG, 'hidden lg:inline-flex')}
          >
            <Lock className="size-4" aria-hidden />
            Pay {formatFromPrice(total)}
          </Button>
          <p className="inline-flex items-center gap-2 text-caption text-muted-foreground">
            <ShieldCheck className="size-3.5" aria-hidden />
            Nothing is charged until you complete the checkout.
          </p>
        </div>
      </div>
    </section>
  );
}
