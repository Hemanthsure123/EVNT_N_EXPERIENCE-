'use client';

import * as React from 'react';
import { AlertTriangle, Ban } from 'lucide-react';
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  Input,
} from '@/components/ui';
import { cancelEvent, type CancelEventResult } from '@/lib/api/organizer-writes';
import { errorMessage } from '@/lib/api/errors';
import { useInvalidateOrganizer } from '@/lib/organizer/queries';
import type { EventRow } from '@/lib/api/organizer';

/**
 * Call a live event off.
 *
 * ── IT IS NOT ARCHIVE, AND THE UI HAS TO SAY SO ───────────────────────────
 *
 * Archive retires an event nobody holds a ticket to — the server refuses it
 * for `live`. This one refunds every buyer and emails every ticket holder.
 * They sit next to each other and one of them spends money, so this is the
 * only control on the organiser dashboard behind a typed confirmation.
 *
 * ── NO UNDO, BECAUSE THERE IS NO COMPENSATING WRITE ───────────────────────
 *
 * The dashboard prefers undo to a dialog wherever the write is reversible.
 * This one is not: refunds have been issued and inventory released, so
 * "resuming" would mean re-charging people who were refunded and re-issuing
 * tickets nobody holds. An undo toast here would promise something that
 * cannot happen.
 *
 * ── THE REASON IS REQUIRED, AND SAID SO TWICE ─────────────────────────────
 *
 * The server refuses a blank one and every ticket holder is shown it verbatim
 * in the cancellation email. "Cancelled" with no explanation is the single
 * biggest generator of support mail this whole flow exists to prevent, so the
 * field says who reads it rather than just being marked required.
 */

export function CancelEventButton({ row }: { row: EventRow }) {
  const invalidate = useInvalidateOrganizer();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [confirmText, setConfirmText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<CancelEventResult | null>(null);

  // Only an event with somebody to tell. `draft`/`rejected` have no ticket
  // holders and `finished` already happened — the server refuses all three, so
  // rendering the button for them would be offering a control that can only
  // fail.
  if (row.status !== 'live' && row.status !== 'paused') return null;

  const armed = confirmText.trim() === row.title.trim() && reason.trim().length > 0;

  const close = () => {
    setOpen(false);
    setReason('');
    setConfirmText('');
    setError(null);
    setDone(null);
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setDone(await cancelEvent(row.id, reason.trim()));
      void invalidate();
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        leftIcon={<Ban className="size-3.5" aria-hidden />}
        className="text-muted-foreground hover:bg-destructive-subtle hover:text-destructive-subtle-foreground"
      >
        Cancel event
      </Button>

      <Drawer open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DrawerContent side="responsive" className="sm:max-w-lg">
          {done ? (
            // What it ACTUALLY did. A bare "cancelled" would leave somebody who
            // just spent money with no idea how much.
            <div className="flex flex-col gap-stack-lg">
              <DrawerTitle className="text-h4">{done.title} is cancelled</DrawerTitle>
              <ul className="flex flex-col gap-1 text-body-sm text-muted-foreground">
                <li>
                  <span className="font-medium tabular-nums text-foreground">
                    {done.refunds_enqueued}
                  </span>{' '}
                  {done.refunds_enqueued === 1 ? 'refund' : 'refunds'} started
                </li>
                <li>
                  <span className="font-medium tabular-nums text-foreground">
                    {done.attendees_notified}
                  </span>{' '}
                  {done.attendees_notified === 1 ? 'attendee' : 'attendees'} emailed
                </li>
                <li>
                  <span className="font-medium tabular-nums text-foreground">
                    {done.holds_released}
                  </span>{' '}
                  unpaid {done.holds_released === 1 ? 'hold' : 'holds'} released
                </li>
              </ul>
              <p className="text-caption text-muted-foreground">
                Refunds go back to the account each person paid from. Cards take 5-7 working days;
                UPI is usually 1-3. The event page stays up and says it was cancelled, so anyone
                opening the link from their email sees what happened.
              </p>
              <Button className="self-end" onClick={close}>
                Done
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-stack-lg">
              <DrawerTitle className="text-h4">Cancel {row.title}?</DrawerTitle>
              <DrawerDescription className="text-body-sm text-muted-foreground">
                Everyone who booked is refunded and emailed, and unpaid holds are released.
                This cannot be undone. To stop selling without cancelling, take the event
                off sale instead.
              </DrawerDescription>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="cancel-reason" className="text-body-sm font-medium">
                  Why is it cancelled?
                </label>
                <textarea
                  id="cancel-reason"
                  value={reason}
                  maxLength={500}
                  rows={3}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="The headline act has withdrawn and we could not find a replacement."
                  className="w-full rounded-md border border-input bg-surface px-3 py-2 text-body text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                />
                <p className="text-caption text-muted-foreground">
                  Everyone who booked reads this, word for word, in their cancellation email.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="cancel-confirm" className="text-body-sm font-medium">
                  Type <span className="font-semibold text-foreground">{row.title}</span> to confirm
                </label>
                {/* A typed confirmation, not a checkbox. This is the one
                    control on the dashboard that spends money on press, and it
                    sits beside Archive, which does not — the friction is what
                    keeps the two apart. */}
                <Input
                  id="cancel-confirm"
                  value={confirmText}
                  onChange={(event) => setConfirmText(event.target.value)}
                  autoComplete="off"
                />
              </div>

              {error ? (
                <p
                  role="alert"
                  className="flex items-start gap-2 text-caption text-destructive-subtle-foreground"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {error}
                </p>
              ) : null}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={close} disabled={busy}>
                  Keep it on sale
                </Button>
                <Button
                  variant="destructive"
                  disabled={!armed || busy}
                  loading={busy}
                  onClick={() => void run()}
                >
                  Cancel and refund everyone
                </Button>
              </div>
            </div>
          )}
        </DrawerContent>
      </Drawer>
    </>
  );
}
