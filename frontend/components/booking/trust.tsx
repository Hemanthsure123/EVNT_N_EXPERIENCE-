import * as React from 'react';
import {
  Clock3,
  FlaskConical,
  Lock,
  QrCode,
  Receipt,
  ShieldCheck,
  Ticket,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * Trust marks, and only the ones that are true.
 *
 * The brief lists "Verified Event" and "Official Organizer" among the examples.
 * Neither is built: `organizations` runs a verification flow, but its outcome is
 * not on the event payload, so this page cannot check it. A trust badge that
 * nothing verifies is the single worst thing to fabricate on a checkout — it is
 * the exact claim someone leans on when deciding to type a card number.
 *
 * Every mark below is a property of the system that a reader could go and
 * confirm: tickets really are signed QR codes issued the moment payment is
 * confirmed; the payment really does happen on the provider's own encrypted
 * checkout with no card data touching this site; refunds really do void the
 * tickets they cover.
 *
 * Icons with two or three words, never a paragraph. A wall of reassurance reads
 * as protesting too much.
 *
 * ── IT IS A BAND, NOT A CARD ──────────────────────────────────────────────
 *
 * The strip used to be `bg-surface` with a border and a `bg-muted` medallion
 * behind every icon: on a white page that is a white card carrying four more
 * boxes, sitting at the same visual weight as the ticket cards it is supposed
 * to be supporting. It is now a `--sunken` band — the one value step light
 * theme has, and exactly what it is for — with bare icons in tertiary ink. Same
 * four claims, a quarter of the chrome, and it no longer competes with the
 * decision above it.
 */

export type TrustMark = { icon: LucideIcon; label: string };

export const CHECKOUT_TRUST: TrustMark[] = [
  { icon: Lock, label: 'Encrypted payment' },
  { icon: QrCode, label: 'Instant QR ticket' },
  { icon: Ticket, label: 'One scan at the gate' },
  { icon: Receipt, label: 'Refunds void tickets' },
];

/**
 * The demo deployment's version, and the difference is the point of this file.
 *
 * "Encrypted payment" describes a provider checkout that is not happening when
 * no provider is connected, so it comes out — a true claim about a system in
 * one configuration is a false one in another, and this strip only carries
 * claims a reader could go and confirm. The other three survive unchanged
 * because they are properties of the TICKET, which is issued for real either
 * way: a signed QR, admitted once, voided on refund.
 */
export const DEMO_CHECKOUT_TRUST: TrustMark[] = [
  { icon: FlaskConical, label: 'No money moves' },
  { icon: QrCode, label: 'Instant QR ticket' },
  { icon: Ticket, label: 'One scan at the gate' },
  { icon: Receipt, label: 'Refunds void tickets' },
];

export const BOOKING_TRUST: TrustMark[] = [
  { icon: ShieldCheck, label: 'Secure booking' },
  { icon: Clock3, label: 'Tickets held while you pay' },
  { icon: QrCode, label: 'Instant confirmation' },
  { icon: Lock, label: 'No card details stored' },
];

/**
 * The account's Bookings & Purchases list.
 *
 * The same rule as every other set here: each claim is a property of the system
 * a reader could go and confirm. The reference this screen was built to shows
 * "100% Genuine Passes" and "Curatix Protected" — the first is a guarantee
 * nobody underwrites and the second names a programme that does not exist, and
 * a trust badge with nothing behind it is worst on the screen somebody opens
 * when they are already worried.
 *
 * "No card details stored" replaces the checkout's "Encrypted payment": on a
 * history screen no payment is in flight, and what matters after the fact is
 * what was KEPT — which is only the provider's reference ids and an amount.
 */
export const WALLET_TRUST: TrustMark[] = [
  { icon: QrCode, label: 'Signed QR passes' },
  { icon: Ticket, label: 'One scan at the gate' },
  { icon: Lock, label: 'No card details stored' },
  { icon: Receipt, label: 'Refunds void tickets' },
];

/** A horizontal strip — used under the ticket picker and on review. */
export function TrustStrip({ marks, className }: { marks: TrustMark[]; className?: string }) {
  return (
    <ul
      className={cn(
        'grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border bg-sunken p-card sm:grid-cols-4',
        className,
      )}
    >
      {marks.map((mark) => (
        <li key={mark.label} className="flex items-center gap-2.5">
          <mark.icon className="size-4 shrink-0 text-foreground-subtle" aria-hidden />
          <span className="min-w-0 text-caption text-muted-foreground">{mark.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** A compact stack — used inside the summary card, where width is scarce. */
export function TrustList({ marks, className }: { marks: TrustMark[]; className?: string }) {
  return (
    <ul className={cn('flex flex-col gap-2', className)}>
      {marks.map((mark) => (
        <li key={mark.label} className="flex items-center gap-2 text-caption text-muted-foreground">
          <mark.icon className="size-3.5 shrink-0" aria-hidden />
          {mark.label}
        </li>
      ))}
    </ul>
  );
}
