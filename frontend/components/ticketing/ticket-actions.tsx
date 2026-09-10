'use client';

import * as React from 'react';
import { Check, Mail, Share2 } from 'lucide-react';
import type { EventDetail } from '@/lib/api/types';
import { AddToCalendar } from '@/components/event/add-to-calendar';
import { eventPath } from '@/lib/events/ref';
import { cn } from '@/lib/utils/cn';

/**
 * Share · Receipt · Calendar — one row of three equal pills under the ticket.
 *
 * They used to stack, and stacked they were broken: `flex-1` inside a COLUMN
 * flexbox sets a zero flex-basis on the HEIGHT axis, so each button shrank to
 * its line of text and the fixed height was ignored — two thin slivers under
 * the ticket. A three-column grid gives every pill the same width and the same
 * 48px height by construction.
 *
 * ── WHAT "SHARE" SHARES ───────────────────────────────────────────────────
 *
 * The EVENT, never the ticket. A QR code is a bearer credential — whoever holds
 * it is admitted — so a share control that sent the code would be a way to give
 * a seat away by accident. This hands the event's own public URL to the phone's
 * share sheet (or copies it where there is none), which is what "tell my
 * friends where I'm going" actually needs. The receipt is the separate, emailed
 * PDF — the next pill.
 *
 * The visible labels are short because three pills share ~100px each on a
 * 360px phone; every accessible name is the full phrase.
 */
export function TicketActions({
  event,
  onEmailReceipt,
  receiptDisabled = false,
}: {
  event: EventDetail;
  onEmailReceipt: () => void;
  receiptDisabled?: boolean;
}) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const share = async () => {
    const url = `${window.location.origin}${eventPath(event)}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: event.title, text: `I'm going to ${event.title}`, url });
      } catch {
        // Dismissing the share sheet rejects with AbortError. That is somebody
        // changing their mind, not a failure worth a message.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // No clipboard on an insecure origin, or refused. The label stays as it
      // was rather than claiming a copy that did not happen.
    }
  };

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      <button
        type="button"
        onClick={() => void share()}
        aria-label={copied ? 'Event link copied' : 'Share this event'}
        className={PILL}
      >
        {copied ? (
          <Check className="size-4 shrink-0 text-success-500" aria-hidden />
        ) : (
          <Share2 className="size-4 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 truncate">{copied ? 'Copied' : 'Share'}</span>
      </button>

      <button
        type="button"
        onClick={onEmailReceipt}
        disabled={receiptDisabled}
        aria-label="Email the receipt"
        className={PILL}
      >
        <Mail className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">Receipt</span>
      </button>

      {/* `!px-*`: the trigger's own `px-pill` is a named token tailwind-merge
          cannot see as padding, so without the `!` the stylesheet's order —
          not this className — would decide, and the wider token wins. */}
      <AddToCalendar event={event} label="Calendar" className={cn(PILL, '!px-2.5 sm:!px-4')} />
    </div>
  );
}

/**
 * The one pill recipe the three share — same height, same border, same type —
 * on the ticket screen's dark surface. `justify-center` and `min-w-0` so a
 * label can never push its icon off-centre or the pill out of its column.
 */
const PILL = cn(
  'inline-flex h-control-lg min-w-0 items-center justify-center gap-1.5 rounded-full',
  'border border-ink-700 bg-transparent px-2.5 text-label text-ink-25 sm:px-4',
  'transition-colors duration-fast hover:border-ink-500 hover:bg-ink-800 hover:text-white',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950',
  'disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none',
);
