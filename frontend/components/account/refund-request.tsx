'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { requestRefund } from '@/lib/api/refund-requests';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/utils/cn';

/**
 * Asking for your money back.
 *
 * ── A REFUND IS PER BOOKING, AND THE DIALOG HAS TO SAY SO ─────────────────
 *
 * The backend refunds a PAYMENT, and a payment covers a whole booking. Four
 * tickets bought together are one booking and one refund — there is no partial
 * path, and approving one voids all four. Someone opening this from a single
 * ticket card is one press away from cancelling the other three, so the count
 * is stated before the button, not after.
 *
 * ── THE REASON IS REQUIRED BECAUSE A HUMAN READS IT ───────────────────────
 *
 * This is not a form that resolves itself. An organiser sees these words
 * verbatim and decides on them, so an empty box is a request that will be
 * declined for lack of anything to weigh. The minimum is short — enough to
 * stop an accidental submit, not enough to be a hurdle.
 *
 * ── WHAT IT PROMISES ──────────────────────────────────────────────────────
 *
 * Nothing about the outcome. The dialog says a person will decide and that an
 * email follows either way, because that is all that is true at the moment of
 * pressing. Wording it as "your refund is on its way" would be the same class
 * of lie as an approved request rendering as refunded money.
 */

const MIN_REASON = 10;
const MAX_REASON = 500;

export type RefundTarget = {
  bookingId: string;
  eventTitle: string;
  /** How many of this account's tickets the refund would void. */
  ticketCount: number;
};

export function RefundRequestDialog({
  target,
  onClose,
}: {
  target: RefundTarget | null;
  onClose: () => void;
}) {
  const [reason, setReason] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const toast = useToast();
  const queryClient = useQueryClient();

  // A fresh box every time it opens. Reusing the last attempt's text is how a
  // reason meant for one booking gets submitted against another.
  React.useEffect(() => {
    if (target) {
      setReason('');
      setTouched(false);
    }
  }, [target]);

  const mutation = useMutation({
    mutationFn: (input: { bookingId: string; reason: string }) =>
      requestRefund(input.bookingId, input.reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['account', 'refund-requests'] });
      toast.toast({
        title: 'Request sent',
        description: 'The organiser will decide, and you will get an email either way.',
        variant: 'success',
      });
      onClose();
    },
    onError: (error: unknown) => {
      // The two 409s are real answers, not failures — each needs its own
      // sentence or the person retries something that can never work.
      const code = error instanceof ApiError ? error.code : undefined;
      const description =
        code === 'refund_request_already_open'
          ? 'There is already an open request for this booking. Check its status on this page.'
          : code === 'booking_not_refundable'
            ? 'This booking was never charged, so there is nothing to refund.'
            : error instanceof ApiError
              ? error.message
              : 'Could not send the request. Please try again.';
      toast.toast({ title: 'Not sent', description, variant: 'destructive' });
    },
  });

  const trimmed = reason.trim();
  const tooShort = trimmed.length < MIN_REASON;
  const showError = touched && tooShort;

  return (
    <Modal open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <ModalContent className="sm:max-w-lg">
        <ModalHeader>
          <ModalTitle>Request a refund</ModalTitle>
          <ModalDescription>
            {target ? (
              <>
                For <span className="font-medium text-foreground">{target.eventTitle}</span>.{' '}
                {target.ticketCount > 1 ? (
                  <>
                    This covers the whole booking — all {target.ticketCount} tickets would be
                    cancelled together.
                  </>
                ) : (
                  <>Your ticket would be cancelled and stops working at the gate.</>
                )}
              </>
            ) : null}
          </ModalDescription>
        </ModalHeader>

        <div className="flex flex-col gap-stack">
          <label htmlFor="refund-reason" className="text-label text-foreground">
            Why are you asking?
          </label>
          <Textarea
            id="refund-reason"
            rows={4}
            value={reason}
            maxLength={MAX_REASON}
            onChange={(event) => setReason(event.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={showError || undefined}
            aria-describedby="refund-reason-hint"
            placeholder="Tell the organiser what happened — plans changed, wrong date, event moved."
            disabled={mutation.isPending}
          />
          <p
            id="refund-reason-hint"
            className={cn('text-caption', showError ? 'text-danger' : 'text-muted-foreground')}
          >
            {showError
              ? 'Please add a sentence — a person reads this and decides on it.'
              : 'The organiser reads this and decides. You will get an email either way.'}
          </p>
        </div>

        <ModalFooter>
          <button
            type="button"
            onClick={onClose}
            disabled={mutation.isPending}
            className="inline-flex h-control items-center justify-center rounded-full border border-border bg-surface px-pill text-label text-foreground transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60"
          >
            Keep my ticket
          </button>
          <button
            type="button"
            disabled={mutation.isPending || tooShort || !target}
            onClick={() => {
              setTouched(true);
              if (!target || tooShort) return;
              mutation.mutate({ bookingId: target.bookingId, reason: trimmed });
            }}
            className="inline-flex h-control items-center justify-center gap-2 rounded-full bg-cta px-pill text-label text-cta-foreground shadow-sm transition-colors duration-fast hover:bg-cta-hover active:bg-cta-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60"
          >
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Send request
          </button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
