'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ArrowLeft, Loader2, TicketPercent } from 'lucide-react';
import type { PublicOffer } from '@/lib/api/types';
import { MAX_CODE_LENGTH, MIN_CODE_LENGTH, offerOutcome } from '@/lib/booking/coupons';
import { cn } from '@/lib/utils/cn';
import { CouponTicket } from './coupon-ticket';

/**
 * APPLY COUPON — the full-screen chooser the review screen's Offers row opens.
 *
 * ── RADIX, NOT A HAND-ROLLED OVERLAY ──────────────────────────────────────
 *
 * The focus trap, Escape, the inert background, `aria-modal` and scroll
 * locking are the library's. Seven hand-built dialogs would be seven sets of
 * focus bugs, and this one sits in front of a payment. It PORTALS to the body,
 * so nothing transformed on the checkout underneath can capture its `fixed`
 * positioning — the same trap the event page's lightbox portal exists for.
 *
 * Full screen on a phone, where a centred panel puts its controls out of a
 * thumb's reach; a tall centred panel from `sm`, where a full-bleed page would
 * be a navigation rather than a chooser.
 *
 * ── IT CLOSES ON SUCCESS, AND ONLY THEN ────────────────────────────────────
 *
 * A code is applied by the SERVER, so this sheet cannot know it worked when the
 * button is pressed. It records which code it asked for and closes when the
 * booking comes back carrying that code. A refusal leaves it open with the
 * server's own sentence under the field, because the next thing somebody does
 * after a refused code is try another one — and closing would make them open
 * this again to do it.
 */
export function ApplyCouponSheet({
  open,
  onOpenChange,
  offers,
  appliedCode,
  subtotal,
  donation,
  pending,
  error,
  disabled,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offers: PublicOffer[];
  appliedCode: string | null;
  /** The TICKET subtotal the server prices a code against, in minor units. */
  subtotal: number;
  donation: number;
  pending: boolean;
  /** The server's sentence for the last refusal, shown verbatim. */
  error: string | null;
  disabled: boolean;
  onApply: (code: string) => void;
}) {
  const [draft, setDraft] = React.useState('');
  /** The code this sheet last asked the server for, until it lands or fails. */
  const [asked, setAsked] = React.useState<string | null>(null);

  const code = draft.trim();
  const couldBeACode = code.length >= MIN_CODE_LENGTH && code.length <= MAX_CODE_LENGTH;
  const tooShort = code.length > 0 && code.length < MIN_CODE_LENGTH;

  // Closed on the booking coming back WITH the code — the only proof it worked.
  React.useEffect(() => {
    if (!open || pending || asked === null) return;
    if (appliedCode === asked) {
      setAsked(null);
      setDraft('');
      onOpenChange(false);
    } else if (error) {
      setAsked(null);
    }
  }, [open, pending, asked, appliedCode, error, onOpenChange]);

  // A fresh open starts with an empty field, not the last attempt's leftovers.
  React.useEffect(() => {
    if (open) return;
    setDraft('');
    setAsked(null);
  }, [open]);

  const apply = (value: string) => {
    if (pending || disabled) return;
    setAsked(value);
    onApply(value);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!couldBeACode) return;
    apply(code);
  };

  const order = { subtotalMinor: subtotal, donationMinor: donation };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-modal bg-overlay/60 backdrop-blur-sm animate-in fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          aria-describedby="apply-coupon-description"
          className={cn(
            'fixed inset-0 z-modal flex flex-col bg-background text-foreground',
            'animate-in fade-in-0 slide-in-from-bottom-4 duration-fast data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-4',
            'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-[85vh] sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:overflow-hidden sm:rounded-2xl sm:border sm:border-border sm:shadow-xl',
          )}
          // Focus the FIELD, not the back arrow: somebody who opened a sheet
          // called "Apply coupon" came here to type a code.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById('apply-coupon-code')?.focus();
          }}
        >
          {/* ── HEADER: back on the left, the title in capitals ──────────── */}
          <header className="flex items-center gap-2 border-b border-border px-2 py-2">
            <DialogPrimitive.Close
              aria-label="Back to your booking"
              className="inline-flex size-control items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="size-5" aria-hidden />
            </DialogPrimitive.Close>
            <DialogPrimitive.Title className="text-body font-extrabold uppercase tracking-widest">
              Apply coupon
            </DialogPrimitive.Title>
          </header>
          <DialogPrimitive.Description id="apply-coupon-description" className="sr-only">
            Enter a promo code, or choose one of the offers running for this event.
          </DialogPrimitive.Description>

          <div className="flex flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-4 py-5">
            {/* ── TYPE A CODE ─────────────────────────────────────────── */}
            <form onSubmit={submit} className="flex flex-col gap-2">
              <label htmlFor="apply-coupon-code" className="sr-only">
                Promo code
              </label>
              <div className="flex items-center gap-2 rounded-full border border-input bg-surface py-1 pl-5 pr-1 focus-within:ring-2 focus-within:ring-ring">
                <input
                  id="apply-coupon-code"
                  name="apply-coupon-code"
                  value={draft}
                  // Upper-cased as it is typed, because that is how codes are
                  // stored and how they are printed on the poster they were
                  // copied from.
                  onChange={(changed) => setDraft(changed.target.value.toUpperCase())}
                  placeholder="Enter coupon code"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={MAX_CODE_LENGTH}
                  aria-invalid={Boolean(error) || undefined}
                  aria-describedby={error || tooShort ? 'apply-coupon-note' : undefined}
                  disabled={disabled}
                  className="min-w-0 flex-1 bg-transparent text-body font-semibold uppercase tracking-wide text-foreground placeholder:font-normal placeholder:normal-case placeholder:tracking-normal placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={!couldBeACode || pending || disabled}
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-body-sm font-extrabold uppercase tracking-wide text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:text-muted-foreground disabled:hover:bg-transparent"
                >
                  {pending && asked === code ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : null}
                  Apply
                </button>
              </div>

              {/* ONE note slot, neutral rather than red — the platform rule
                  (`ui/notice.tsx`). `role="alert"` only for the server's
                  refusal: that is the answer to a press. */}
              {error ? (
                <p id="apply-coupon-note" role="alert" className="px-5 text-caption text-muted-foreground">
                  {error}
                </p>
              ) : tooShort ? (
                <p id="apply-coupon-note" className="px-5 text-caption text-muted-foreground">
                  {`Promo codes are at least ${MIN_CODE_LENGTH} characters.`}
                </p>
              ) : null}
            </form>

            {/* ── THE OFFERS ──────────────────────────────────────────── */}
            <section aria-labelledby="apply-coupon-offers" className="flex flex-col gap-3">
              <h3
                id="apply-coupon-offers"
                className="text-caption font-extrabold uppercase tracking-widest text-muted-foreground"
              >
                More offers
              </h3>
              {offers.length ? (
                <ul className="flex flex-col gap-3">
                  {offers.map((offer) => (
                    <li key={offer.id}>
                      <CouponTicket
                        offer={offer}
                        outcome={offerOutcome(offer, order)}
                        applied={appliedCode === offer.code}
                        pending={pending && asked === offer.code}
                        disabled={pending || disabled}
                        onApply={apply}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                // Said plainly rather than drawn as an empty list: most events
                // run no advertised codes, and the field above still works for
                // one somebody was sent.
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-8 text-center">
                  <TicketPercent className="size-6 text-muted-foreground" aria-hidden />
                  <p className="text-body-sm text-muted-foreground">
                    No offers are running for this event right now. If you were sent a code, enter
                    it above.
                  </p>
                </div>
              )}
            </section>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
