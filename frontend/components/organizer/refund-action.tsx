'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api/errors';
import { refundPayment } from '@/lib/api/organizer-writes';
import type { OrganizerBooking } from '@/lib/api/organizer';
import { formatMoney } from '@/lib/discovery/format';
import { cn } from '@/lib/utils/cn';

/**
 * Returning the money.
 *
 * ── ITS OWN FILE, BECAUSE IT IS THE ONE WRITE ON THAT PANEL ───────────────
 *
 * The booking inspector is a READ surface: everything else on it navigates or
 * copies a reference. This is the single control that moves money, and keeping
 * it separate means the panel's own rule — nothing here is a filled pill,
 * because nothing here acts — stays true of the file it is written in.
 *
 * ── IT ENABLES ON A FACT, NOT AN INFERENCE ────────────────────────────────
 *
 * `POST /payments/{id}/refund` takes OUR `Payment.id`. The booking row used to
 * carry only `payment_ref`, which is the vendor's id and a different value, so
 * a refund button here would have been guessing a handle on the money path —
 * which is why there wasn't one. The payload now carries `payment_id`,
 * computed server-side as the payment that can actually be refunded (`paid`
 * only; a refunded or never-captured booking reports null).
 *
 * ── THE CONFIRMATION IS NOT ABOUT DOUBLE-CLICKS ───────────────────────────
 *
 * The endpoint is idempotent and its vendor call carries an idempotency key,
 * so a double submission cannot double-refund. That is the backstop, and it is
 * not what this guards. The failure worth guarding is an operator refunding
 * the WRONG ROW while working a queue at speed, and no amount of server-side
 * idempotency helps with that. So the control arms only once the exact amount
 * is typed back — a number that is different for every row.
 *
 * ── PARTIAL REFUNDS ARE DELIBERATELY NOT OFFERED ──────────────────────────
 *
 * The endpoint accepts an amount, but nothing on this platform records WHY a
 * partial was chosen — no note, no line selection. A partial refund would
 * therefore appear in the organizer's settlement as an unexplainable number.
 * Full refunds only, until there is somewhere to put the reason (BACKLOG:
 * refund-request workflow).
 */
export function RefundAction({ booking }: { booking: OrganizerBooking }) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<unknown>(null);

  const refund = useMutation({
    mutationFn: () => refundPayment(booking.payment_id as string, 'Refunded by organizer'),
    onSuccess: () => {
      setError(null);
      setConfirm('');
      // Everything organizer-scoped can move: the booking's status, the
      // refunds list, today's KPI tiles and the settlement it feeds.
      void queryClient.invalidateQueries({ queryKey: ['organizer'] });
    },
    onError: (thrown) => setError(thrown),
  });

  // Nothing to return: a hold that never completed, or one already refunded.
  // Rendering nothing is right — explaining an action that is not on offer is
  // noise on a screen somebody is reading during a phone call.
  if (!booking.payment_id || booking.status !== 'paid') return null;

  if (refund.isSuccess) {
    return (
      <p className="rounded-lg border border-success-subtle bg-success-subtle px-4 py-3 text-body-sm text-success-subtle-foreground">
        Refunded. The tickets are void and cannot be scanned, and the money is on its way back to
        the original payment method.
      </p>
    );
  }

  // Compared in MAJOR units because that is the figure on screen beside it —
  // asking somebody to type the paise count of a number rendered as ₹1,200
  // would be a puzzle rather than a confirmation.
  const expected = String(Math.round(booking.total_amount_minor / 100));
  const armed = confirm.trim() === expected && !refund.isPending;

  return (
    <section className="flex flex-col gap-stack border-t border-border pt-stack-lg">
      <h3 className="text-body-sm font-semibold">Refund this booking</h3>
      <p className="max-w-prose text-caption text-muted-foreground">
        Returns {formatMoney(booking.total_amount_minor)} to the original payment method and voids
        the tickets, so they can no longer be scanned. This cannot be undone.
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`refund-confirm-${booking.id}`}>
          Type <span className="font-semibold text-foreground">{expected}</span> to confirm the
          amount
        </Label>
        <Input
          id={`refund-confirm-${booking.id}`}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          inputMode="numeric"
          autoComplete="off"
          className="max-w-40"
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-destructive-subtle bg-destructive-subtle px-4 py-3 text-body-sm text-destructive-subtle-foreground"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {/* The server's own sentence. It knows whether the payment was
              already refunded, outside its window, or refused by the provider,
              and paraphrasing it here would drift the moment a rule changes. */}
          <span>
            {error instanceof ApiError
              ? error.message
              : 'The refund could not be started. Nothing was returned — try again.'}
          </span>
        </p>
      ) : null}

      <Button
        variant="ghost"
        onClick={() => refund.mutate()}
        loading={refund.isPending}
        disabled={!armed}
        className={cn(
          'w-fit border border-destructive-subtle text-destructive-subtle-foreground',
          'hover:bg-destructive-subtle',
        )}
      >
        <RotateCcw className="size-3.5" aria-hidden />
        Refund {formatMoney(booking.total_amount_minor)}
      </Button>
    </section>
  );
}
