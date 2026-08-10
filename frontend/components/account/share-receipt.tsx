'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Plus, Send, X } from 'lucide-react';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';
import { Modal, ModalContent } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils/cn';

/**
 * ── SEND THE RECEIPT, NOT THE TICKET ──────────────────────────────────────
 *
 * Somebody who books for four friends wants to send those friends what they
 * were charged. This does that: a one-page PDF receipt — event, booking id,
 * itemised amounts, total — emailed to the addresses they name.
 *
 * It does NOT send the QR codes, and the wording here says so in two places
 * because the assumption runs the other way. Every serious platform treats the
 * scannable code as a bearer credential: Ticketmaster's transfer emails a
 * CLAIM LINK and issues the recipient a NEW code once they accept; DICE will
 * only move a ticket between accounts inside its own app. A PDF is forwardable
 * by everyone it reaches, so a code on one admits whoever opens the mail next.
 *
 * Nor does it send a link back into the account. A receipt is not a session,
 * and "view my tickets" in a mail to four people is an invitation into
 * somebody else's wallet.
 *
 * ── ADDRESSES ARE CHIPS, NOT A COMMA-SEPARATED STRING ─────────────────────
 *
 * One committed address per chip, each removable. A single text field means
 * guessing a delimiter somebody typed, and a typo in the middle of a string
 * fails the whole send with nothing to point at. Enter and comma both commit,
 * because both are what people reach for.
 */

const MAX_RECIPIENTS = 10;

export type ShareTarget = {
  bookingId: string;
  eventTitle: string;
  ticketCount: number;
};

export function ShareReceiptDialog({
  target,
  onClose,
}: {
  target: ShareTarget | null;
  onClose: () => void;
}) {
  const [emails, setEmails] = React.useState<string[]>([]);
  const [draft, setDraft] = React.useState('');
  const [note, setNote] = React.useState('');
  const [problem, setProblem] = React.useState<string | null>(null);

  // Cleared on open rather than on close: closing mid-send would otherwise
  // wipe the fields under a request that has not come back yet.
  React.useEffect(() => {
    if (target) {
      setEmails([]);
      setDraft('');
      setNote('');
      setProblem(null);
      send.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `send` is stable
  }, [target]);

  const send = useMutation({
    mutationFn: (payload: { emails: string[]; note: string }) =>
      api.post<{ queued: number }>(
        `/bookings/${encodeURIComponent(target?.bookingId ?? '')}/share-receipt`,
        payload,
      ),
  });

  const commit = (raw: string): boolean => {
    const candidate = raw.trim().toLowerCase().replace(/,$/, '');
    if (!candidate) return true;
    // Deliberately loose. The server validates properly and is the authority;
    // a strict client regex is how a legitimate address gets refused by a
    // rule nobody can see.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
      setProblem(`${candidate} does not look like an email address.`);
      return false;
    }
    if (emails.includes(candidate)) {
      setDraft('');
      return true;
    }
    if (emails.length >= MAX_RECIPIENTS) {
      setProblem(`You can send this to ${MAX_RECIPIENTS} people at a time.`);
      return false;
    }
    setEmails((current) => [...current, candidate]);
    setDraft('');
    setProblem(null);
    return true;
  };

  const submit = () => {
    // Commit whatever is still in the field. Somebody who types an address and
    // presses Send has finished entering it — losing it because they did not
    // press Enter first is the most annoying possible way to fail.
    const pending = draft.trim();
    if (pending && !commit(pending)) return;
    const all = pending && !emails.includes(pending.toLowerCase()) ? [...emails, pending.toLowerCase()] : emails;
    if (all.length === 0) {
      setProblem('Add at least one email address.');
      return;
    }
    send.mutate({ emails: all, note: note.trim() });
  };

  const sent = send.isSuccess;

  return (
    <Modal open={target !== null} onOpenChange={(next: boolean) => !next && onClose()}>
      <ModalContent className="sm:max-w-lg">
        {target ? (
          <div className="flex flex-col gap-stack">
            <div>
              <h2 className="text-h4">Share the receipt</h2>
              <p className="text-body-sm text-muted-foreground">
                {target.eventTitle} · {target.ticketCount === 1 ? '1 ticket' : `${target.ticketCount} tickets`}
              </p>
            </div>

            {sent ? (
              <>
                <div className="rounded-lg border border-border bg-sunken p-card">
                  <p className="text-body-sm text-foreground">
                    Sent to {send.data?.queued === 1 ? '1 person' : `${send.data?.queued} people`}.
                    The receipt is on its way as a PDF.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-control w-fit items-center rounded-full bg-cta px-pill text-label text-cta-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <label htmlFor="share-email" className="text-label">
                    Send to
                  </label>
                  {emails.length ? (
                    <ul className="flex flex-wrap gap-2">
                      {emails.map((email) => (
                        <li key={email}>
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface py-1 pl-3 pr-1.5 text-body-sm">
                            {email}
                            <button
                              type="button"
                              onClick={() => setEmails((c) => c.filter((e) => e !== email))}
                              aria-label={`Remove ${email}`}
                              className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <X className="size-3.5" aria-hidden />
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="flex gap-2">
                    <Input
                      id="share-email"
                      type="email"
                      inputMode="email"
                      autoComplete="off"
                      placeholder="friend@example.com"
                      value={draft}
                      onChange={(event) => {
                        setDraft(event.target.value);
                        setProblem(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ',') {
                          event.preventDefault();
                          commit(draft);
                        }
                      }}
                      onBlur={() => draft.trim() && commit(draft)}
                    />
                    <button
                      type="button"
                      onClick={() => commit(draft)}
                      aria-label="Add this address"
                      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Plus className="size-4" aria-hidden />
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <label htmlFor="share-note" className="text-label">
                    Add a line <span className="text-muted-foreground">(optional)</span>
                  </label>
                  <Textarea
                    id="share-note"
                    rows={2}
                    maxLength={280}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="See you there!"
                  />
                </div>

                {problem || send.isError ? (
                  <p role="alert" className="text-body-sm text-destructive">
                    {problem ?? errorMessage(send.error)}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={submit}
                    disabled={send.isPending}
                    className={cn(
                      'inline-flex h-control items-center gap-2 rounded-full bg-cta px-pill text-label text-cta-foreground',
                      'disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    )}
                  >
                    {send.isPending ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Send className="size-4" aria-hidden />
                    )}
                    Send receipt
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex h-control items-center rounded-full px-4 text-label text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </ModalContent>
    </Modal>
  );
}
