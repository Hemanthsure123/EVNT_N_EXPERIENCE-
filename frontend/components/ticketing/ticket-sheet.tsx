'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { TicketQrCode } from '@/components/booking/qr-code';
import { cn } from '@/lib/utils/cn';

/**
 * The codes, large enough to scan from a phone held out at a turnstile.
 *
 * Lifted verbatim out of `components/account/tickets.tsx` when that screen was
 * rebuilt as Bookings & Purchases. Nothing about its behaviour changed — the
 * notes below are the original ones and every one of them is a bug this
 * component already had and fixed. Extracting it means the wallet, a booking
 * card and the confirmation screen present a code the same way rather than
 * three ways.
 *
 * ── IT IS A CAROUSEL, BECAUSE PARTIES ARRIVE TOGETHER ─────────────────────
 *
 * It used to show exactly the ticket whose card was pressed. Four people
 * walking into a venue on one booking meant: show code, let one through, close
 * the sheet, find the next card, press it, show code — five interactions per
 * person, at a turnstile, with a queue behind. The set is what somebody holds,
 * so the set is what the sheet shows, and the arrows step through it in place.
 *
 * Only ACTIVE tickets are in it. A used or refunded ticket has no code to
 * present, so including them would put blank slides between the live ones.
 *
 * ── "CAN'T SCAN IT?" GOES TO SUPPORT, NOT TO A STRING ─────────────────────
 *
 * It used to disclose the 180-character signed token with a Copy button. That
 * is the right artefact for a GATE — their scanner has a manual-entry field —
 * and the wrong one for the person holding the phone: somebody whose code will
 * not scan cannot do anything useful with the raw token. What they need is a
 * human, so the link opens a support query with this ticket attached.
 */

export type SheetTicket = {
  id: string;
  event_title: string;
  ticket_type_name: string;
  qr_token: string;
  attendee_name?: string;
};

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

export function TicketSheet({
  open,
  tickets,
  onClose,
}: {
  /**
   * Explicit, and NEVER derived from an index. It was once computed as
   * `startAt >= 0` with the parent passing `0` for "nothing selected", so
   * closing set the state that reopened it at index 0 and the dialog could not
   * be dismissed at all while the account held a scannable ticket.
   */
  open: boolean;
  tickets: SheetTicket[];
  onClose: () => void;
}) {
  const [index, setIndex] = React.useState(0);

  // Back to the first code each time it opens rather than resuming wherever it
  // was left — a party arrives at the gate in order.
  React.useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const safe = Math.min(index, Math.max(tickets.length - 1, 0));
  const ticket = tickets[safe];
  const many = tickets.length > 1;

  const step = React.useCallback(
    (delta: number) => setIndex((current) => (current + delta + tickets.length) % tickets.length),
    [tickets.length],
  );

  // Left/right arrows step through, because this is a gallery and a keyboard
  // user expects them to. Scoped to the sheet being open.
  React.useEffect(() => {
    if (!open || !many) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') step(1);
      if (event.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, many, step]);

  return (
    <Drawer open={open && tickets.length > 0} onOpenChange={(next) => !next && onClose()}>
      <DrawerContent side="responsive" hideClose className="flex flex-col gap-0 p-0 sm:max-w-md">
        {ticket ? (
          <>
            <header className="flex items-start gap-3 border-b border-border p-card">
              <div className="min-w-0 flex-1">
                {/* `DrawerTitle`, not a bare `h2`. This is a Radix Dialog and
                    without a `Dialog.Title` descendant it has NO accessible
                    name — a screen reader announces an unnamed dialog on the
                    surface holding the QR somebody is about to present at a
                    gate — and Radix logs an error on every open. */}
                <DrawerTitle className="truncate">{ticket.event_title}</DrawerTitle>
                <p className="truncate text-body-sm text-muted-foreground">
                  {ticket.ticket_type_name}
                  {many ? ` · Ticket ${safe + 1} of ${tickets.length}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className={cn(
                  'inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground',
                  'transition-colors hover:bg-muted hover:text-foreground',
                  focusRing,
                )}
              >
                <X className="size-4" aria-hidden />
              </button>
            </header>

            <div className="flex flex-col items-center gap-stack-lg p-card-lg text-center">
              <p className="text-body-sm text-muted-foreground">
                Show this at the gate. It admits one person, once.
              </p>

              <div className="flex w-full items-center justify-center gap-2">
                {many ? <SheetArrow side="left" onClick={() => step(-1)} /> : null}
                <TicketQrCode
                  token={ticket.qr_token}
                  label={`QR code for your ${ticket.ticket_type_name} ticket — ${ticket.event_title}`}
                  className="p-3"
                />
                {many ? <SheetArrow side="right" onClick={() => step(1)} /> : null}
              </div>

              {ticket.attendee_name ? (
                <p className="text-body-sm text-foreground">Admits {ticket.attendee_name}</p>
              ) : null}

              {many ? (
                /* Dots, because the count in the header is a fact and this is
                   the position. Buttons rather than decoration: on a phone they
                   are the fastest way to the third person's code. */
                <ul className="flex items-center justify-center gap-2" aria-label="Your tickets">
                  {tickets.map((entry, position) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => setIndex(position)}
                        aria-label={`Show ticket ${position + 1}`}
                        aria-current={position === safe}
                        className={cn(
                          'size-2.5 rounded-full transition-colors duration-fast',
                          focusRing,
                          position === safe ? 'bg-foreground' : 'bg-border hover:bg-border-strong',
                        )}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}

              <Link
                href={`/support?ticket=${encodeURIComponent(ticket.id)}`}
                className={cn(
                  'text-caption text-muted-foreground underline underline-offset-2',
                  'transition-colors hover:text-foreground',
                  focusRing,
                )}
              >
                Can&rsquo;t scan it?
              </Link>

              <p className="text-caption text-foreground-subtle">
                This code identifies your ticket and nothing else — it carries no personal
                information.
              </p>
            </div>
          </>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}

function SheetArrow({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous ticket' : 'Next ticket'}
      className={cn(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-foreground',
        'transition-colors duration-fast hover:bg-muted',
        focusRing,
      )}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}
