'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, FlaskConical, Info, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchBooking } from '@/lib/api/bookings';
import { useAuth } from '@/lib/auth/auth-provider';
import { ApiError } from '@/lib/api/errors';
import { simulatePayment, verifyPayment } from '@/lib/api/payments';
import { resolveProvider } from '@/lib/booking/payment-provider';
import { openCheckout, resolveKeyId } from '@/lib/booking/razorpay';
import { formatFromPrice } from '@/lib/discovery/format';
import { cn } from '@/lib/utils/cn';
import { CTA_PILL_LG, PILL } from './cta';
import { useBooking } from './booking-context';
import { Rise, StepTransition } from './motion';
import { StickyActionBar } from './sticky-action-bar';
import { CHECKOUT_TRUST, DEMO_CHECKOUT_TRUST, TrustStrip } from './trust';

/**
 * Step 4 — pay.
 *
 * NO CUSTOM PAYMENT UI. Everything on this page happens BEFORE Razorpay opens;
 * card entry belongs on the provider's own checkout, which is what keeps card
 * data off this origin entirely and out of scope for the backend (it stores
 * reference ids and amounts, never a card number).
 *
 * THE BROWSER'S RESULT IS NOT PROOF. Razorpay's success callback fires in the
 * page, and a page can be lied to. The backend treats only RAZORPAY'S OWN
 * statement as evidence, so this screen does not mark anything paid — it hands
 * off to the confirmation screen, which POLLS the booking until the backend
 * itself says `paid`. That is slower to write and the only correct way round.
 *
 * WHAT THE SUCCESS CALLBACK IS ALLOWED TO DO is forward the payment ID to
 * `POST /payments/verify`, which makes the SERVER ask Razorpay whether that
 * payment was really captured, for which order, for how much. Same trust model
 * as the webhook — a fact stated by the provider over an authenticated channel
 * — obtained by pulling instead of waiting to be pushed. It exists because a
 * webhook needs a public HTTPS endpoint and a laptop has none, so without it a
 * genuine local payment produces no ticket. It is best-effort and idempotent:
 * it shares the webhook's ledger key, so whichever arrives first wins and the
 * other is a no-op.
 *
 * THREE STATES, AND THE SERVER SAYS WHICH. `POST /bookings` reports which
 * provider actually created the order, so this screen no longer infers it from
 * whether a public key happens to be a non-empty string — a leftover
 * `RAZORPAY_KEY_ID` beside `PAYMENTS_BACKEND=fake` used to render a live "Pay
 * ₹1,200" button that opened Razorpay Checkout with a `fake_order_…` id, which
 * Razorpay rejects only after the customer has committed to paying.
 *
 *   razorpay + a key  → the real checkout.
 *   fake              → a plainly-labelled SIMULATED payment (see below).
 *   razorpay, no key  → "payment provider not configured", and it stops there.
 *
 * THE SIMULATED PAYMENT IS NOT A FAKE SUCCESS SCREEN. It calls
 * `POST /payments/simulate`, which tells the FAKE provider that money arrived
 * for this booking — the amount read off the booking row, never from here — and
 * then runs the identical confirm path a real Razorpay payment runs. A ticket
 * is issued because the provider said it was paid, exactly as in production.
 * What is simulated is the money, not the fulfilment. The backend refuses the
 * call whenever a real provider is configured, so this control cannot appear
 * anywhere money is real.
 *
 * THE ONE FILLED CONTROL on this screen is the black CTA pill, and it carries
 * the amount ("Pay ₹1,200"). Neither of the other two states gets one: the
 * simulate control is an OUTLINE pill, because a filled pill in the position a
 * real Pay button occupies is a claim about what pressing it means; and the
 * "not configured" state has no pill at all — not even a disabled one —
 * because the shape is a promise that pressing it does something.
 */
export function PayStep() {
  const { event, booking, setBooking, paymentKeyId, paymentProvider, totals } = useBooking();
  const { status, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const bookingIdFromUrl = searchParams?.get('booking') ?? null;

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Recover the booking after a reload: context is gone, the id is in the URL.
  const restored = useQuery({
    queryKey: ['booking', bookingIdFromUrl],
    queryFn: () => fetchBooking(bookingIdFromUrl as string),
    enabled: Boolean(bookingIdFromUrl) && !booking && status === 'authenticated',
  });

  React.useEffect(() => {
    if (restored.data && !booking) setBooking(restored.data);
  }, [restored.data, booking, setBooking]);

  React.useEffect(() => {
    if (status === 'anonymous') router.replace(`/booking/${event.id}/login`);
  }, [status, router, event.id]);

  const active = booking ?? restored.data ?? null;
  const keyId = resolveKeyId(paymentKeyId);
  const provider = resolveProvider(paymentProvider);
  const total = active?.total_amount ?? totals.total;
  // Same reason as the review step: a booking created this session has no
  // `items` (that's the summary serializer), one restored via GET does.
  const lines = active?.items?.length
    ? active.items
    : totals.lines.map((line) => ({
        ticket_type_id: line.tier.id,
        ticket_type_name: line.tier.name,
        quantity: line.quantity,
        unit_price: line.tier.price,
      }));
  const paid = active?.status === 'paid';
  // The provider the SERVER named, not an inference from an empty key.
  const isDemo = provider === 'fake';

  React.useEffect(() => {
    if (paid && active) router.replace(`/booking/${event.id}/confirmation?booking=${active.id}`);
  }, [paid, active, router, event.id]);

  if (status !== 'authenticated' || (!active && restored.isPending && bookingIdFromUrl)) {
    return (
      <StepTransition stepKey="pay-loading" className="flex flex-col gap-stack-lg">
        <p
          role="status"
          className="inline-flex items-center gap-2 text-body-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading your order…
        </p>
        <div className="skeleton h-64 w-full rounded-xl" aria-hidden />
      </StepTransition>
    );
  }

  if (!active) {
    return (
      <StepTransition stepKey="pay-missing" className="flex flex-col gap-block">
        <div className="flex flex-col items-start gap-stack-lg rounded-xl border border-border bg-surface p-card-lg shadow-sm">
          <AlertTriangle className="size-6 text-muted-foreground" aria-hidden />
          <div className="flex flex-col gap-1">
            <h1 className="text-h3">We don&apos;t have an order to pay for</h1>
            <p className="text-body-sm text-muted-foreground">
              Choose your tickets again and we&apos;ll hold them for you.
            </p>
          </div>
          <Button asChild size="lg" className={CTA_PILL_LG}>
            <Link href={`/booking/${event.id}`}>Choose tickets</Link>
          </Button>
        </div>
      </StepTransition>
    );
  }

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

  return (
    <StepTransition stepKey="pay" className="flex flex-col gap-section">
      <Rise>
        <header className="flex flex-col gap-stack">
          <h1 className="text-h2 md:text-h1">{isDemo ? 'Complete your booking' : 'Pay securely'}</h1>
          <p className="text-body text-muted-foreground">
            {isDemo
              ? 'No payment provider is connected to this deployment, so this checkout is simulated. Your tickets are real.'
              : 'Card details are entered on Razorpay’s encrypted checkout — they never touch Curatix.'}
          </p>
        </header>
      </Rise>

      <Rise index={2}>
        <section className="flex flex-col gap-stack-lg" aria-labelledby="order-heading">
          <h2 id="order-heading" className="text-h3">
            Your order
          </h2>
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
                    </span>
                  </span>
                  <span className="shrink-0 text-body-sm tabular-nums text-foreground">
                    {formatFromPrice(line.unit_price * line.quantity)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex items-baseline justify-between gap-4 border-t border-border p-card">
              <span className="text-body font-semibold text-foreground">Amount payable</span>
              <span className="text-h3 tabular-nums text-foreground">{formatFromPrice(total)}</span>
            </div>
            <p className="border-t border-border px-card py-3 text-caption text-muted-foreground">
              Includes a {formatFromPrice(active.platform_fee)} platform fee. No taxes or surcharges
              are added at payment.
            </p>
          </div>
        </section>
      </Rise>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive-subtle bg-destructive-subtle p-card text-body-sm text-destructive-subtle-foreground"
        >
          {error}
        </p>
      ) : null}

      {isDemo ? (
        <Rise index={3}>
          {/* DEMO MODE, SAID OUT LOUD. No provider branding, no lock icon, no
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
        </Rise>
      ) : keyId ? (
        <Rise index={3}>
          <div className="hidden flex-col items-end gap-3 lg:flex">
            <Button size="lg" onClick={() => void pay()} loading={busy} className={CTA_PILL_LG}>
              <Lock className="size-4" aria-hidden />
              Pay {formatFromPrice(total)}
            </Button>
            <p className="inline-flex items-center gap-2 text-caption text-muted-foreground">
              <ShieldCheck className="size-3.5" aria-hidden />
              You&apos;ll be returned here once payment completes.
            </p>
          </div>
        </Rise>
      ) : (
        <Rise index={3}>
          {/* Razorpay is the configured provider but no public key reached the
              browser. Everything up to the handoff is real — the booking
              exists, inventory is held, the order id below is the one the
              backend created. What cannot happen is opening a checkout, and
              that is said rather than worked around. */}
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
        </Rise>
      )}

      <Rise index={4}>
        <TrustStrip marks={isDemo ? DEMO_CHECKOUT_TRUST : CHECKOUT_TRUST} />
      </Rise>

      {isDemo ? (
        <StickyActionBar className="lg:hidden" total={total} caption="Demo — nothing is charged">
          <Button
            variant="outline"
            size="lg"
            onClick={() => void simulate()}
            loading={busy}
            className={cn(PILL, 'h-control-lg shrink-0')}
          >
            Simulate
          </Button>
        </StickyActionBar>
      ) : keyId ? (
        <StickyActionBar className="lg:hidden" total={total} caption="Amount payable">
          <Button
            size="lg"
            onClick={() => void pay()}
            loading={busy}
            className={cn(CTA_PILL_LG, 'shrink-0')}
          >
            <Lock className="size-4" aria-hidden />
            Pay
          </Button>
        </StickyActionBar>
      ) : null}
    </StepTransition>
  );
}
