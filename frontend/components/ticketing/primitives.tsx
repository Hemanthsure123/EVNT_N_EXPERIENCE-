'use client';

import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { RemoteImage } from '@/components/ui/remote-image';
import { cn } from '@/lib/utils/cn';

/**
 * ONE VOCABULARY FOR EVERY SCREEN THAT HANDLES SOMEBODY'S MONEY.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * Buying a ticket spans five surfaces — choose, review, pay, confirm, and then
 * live with it in purchase history, a refund, or a failed payment you have to
 * retry. They were built at different times and each grew its own card recipe,
 * its own status pill, its own way of laying out a price breakdown. A person
 * walking that path saw four products.
 *
 * Everything shared between those screens is here, so the confirmation's bill
 * summary and the failed-payment order card and the refund's breakdown are
 * literally the same component rather than three that look alike this week.
 *
 * ── THE TWO SURFACES ──────────────────────────────────────────────────────
 *
 * Most of the product is LIGHT. Two things are DARK in both themes because
 * they are objects rather than pages: the issued ticket and the pass card. A
 * ticket is a physical-object metaphor, and an object does not invert when the
 * page around it does — the same reason a boarding pass is not themed. Every
 * component here that can appear on a dark card takes `onDark`, and the dark
 * values are drawn from the theme-INDEPENDENT `ink` ramp rather than from
 * semantic tokens, which swap places between themes and would vanish.
 *
 * ── NOTHING HERE INVENTS A FACT ───────────────────────────────────────────
 *
 * Every prop is a value the backend actually stores. `MetaRow` renders nothing
 * when its value is empty, `BillLines` skips a line whose amount is null, and
 * `AuditTrail` (its own file) draws a step as pending rather than stamping it
 * with a time nobody recorded. A booking screen is the last place to guess.
 */

/* ────────────────────────────────────────────────────────── status chips ── */

/**
 * The status vocabulary, and it is closed on purpose.
 *
 * Every state a booking can be in for a customer, named once. A screen that
 * needs a sixth adds it here rather than hand-rolling a pill, because the
 * distinction that matters most on these surfaces — "approved" is a decision
 * and "refunded" is a transfer — is exactly the one a locally-invented pill
 * gets wrong.
 */
export type TicketingTone =
  /** A live pass. The one violet fill on the list: it is the thing you came for. */
  | 'pass'
  /** Money settled, nothing outstanding. */
  | 'confirmed'
  /** Done and in the past — no action left. */
  | 'finished'
  /** Money genuinely returned. NOT a decision to return it. */
  | 'refunded'
  /** Something needs the customer. */
  | 'failed'
  /** Waiting on somebody else. */
  | 'pending';

const CHIP: Record<TicketingTone, { light: string; dark: string }> = {
  pass: {
    light: 'bg-primary text-primary-foreground',
    dark: 'bg-violet-500/25 text-violet-100 ring-1 ring-inset ring-violet-400/30',
  },
  confirmed: {
    light: 'bg-success-subtle text-success-subtle-foreground',
    dark: 'bg-success-500/20 text-success-500 ring-1 ring-inset ring-success-500/30',
  },
  finished: {
    light: 'bg-muted text-muted-foreground',
    dark: 'bg-ink-800 text-ink-300',
  },
  refunded: {
    light: 'bg-success-subtle text-success-subtle-foreground',
    dark: 'bg-success-500/20 text-success-500 ring-1 ring-inset ring-success-500/30',
  },
  failed: {
    light: 'bg-destructive-subtle text-destructive-subtle-foreground',
    dark: 'bg-destructive/20 text-destructive ring-1 ring-inset ring-destructive/30',
  },
  pending: {
    light: 'bg-warning-subtle text-warning-subtle-foreground',
    dark: 'bg-warning-subtle text-warning-subtle-foreground',
  },
};

/**
 * A status pill.
 *
 * `icon` is optional and `dot` is the alternative for a LIVE state — a small
 * breathing ring reads as "right now" in a way a static glyph cannot, and it
 * is the only motion on a list of otherwise still cards.
 */
export function StatusChip({
  tone,
  icon: Icon,
  dot = false,
  children,
  onDark = false,
  className,
}: {
  tone: TicketingTone;
  icon?: LucideIcon;
  /** A pulsing dot instead of an icon — for a state that is true *now*. */
  dot?: boolean;
  children: React.ReactNode;
  onDark?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold',
        onDark ? CHIP[tone].dark : CHIP[tone].light,
        className,
      )}
    >
      {dot ? (
        <span
          aria-hidden
          className={cn(
            'size-1.5 shrink-0 rounded-full bg-current',
            // The ring is the project's own keyframe; it stops entirely under
            // `prefers-reduced-motion` (see styles/tokens.css).
            'ticketing-live-dot',
          )}
        />
      ) : Icon ? (
        <Icon className="size-3.5 shrink-0" aria-hidden />
      ) : null}
      {children}
    </span>
  );
}

/* ────────────────────────────────────────────────────────────── meta rows ── */

/**
 * One icon + one fact.
 *
 * Renders NOTHING when the value is empty rather than an icon beside a blank —
 * a venue we do not have is absent, not an empty row that reads as "no venue".
 */
export function MetaRow({
  icon: Icon,
  children,
  onDark = false,
  className,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
  onDark?: boolean;
  className?: string;
}) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <span
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-caption',
        onDark ? 'text-ink-400' : 'text-muted-foreground',
        className,
      )}
    >
      <Icon
        className={cn('size-3.5 shrink-0', onDark ? 'text-violet-400' : 'text-primary')}
        aria-hidden
      />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/* ──────────────────────────────────────────────────────────── poster thumb ── */

/**
 * The artwork on a history row.
 *
 * ── `RemoteImage`, NOT `next/image` ───────────────────────────────────────
 *
 * A poster URL is produced by a CONFIGURABLE storage backend — Supabase, R2,
 * B2, MinIO or S3, chosen by an env var at deploy time — so its host cannot be
 * in `next.config.mjs`'s `remotePatterns`, which is fixed at build time. And
 * `next/image` does not degrade for an unlisted host: it THROWS, which on this
 * screen would take the entire booking list down over one organiser's poster.
 * That was written here first and caught by the screenshot pass.
 *
 * `RemoteImage` is the project's own answer to exactly this, and it already
 * handles the second half too: a stored object that has been deleted, or a
 * signed URL past its expiry, falls back to the neutral tile rather than the
 * browser's torn-page glyph, which readers interpret as the page being broken
 * rather than as one row's picture being missing.
 */
export function PosterThumb({
  src,
  alt,
  className,
}: {
  src: string | null | undefined;
  /** Empty for a decorative thumb whose event is named right beside it. */
  alt: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'relative block size-14 shrink-0 overflow-hidden rounded-xl bg-muted',
        className,
      )}
    >
      <RemoteImage src={src} alt={alt} className="size-full object-cover" />
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────── headings ── */

/**
 * The small caps label above a group of cards.
 *
 * A heading level is REQUIRED rather than defaulted: these sit between a page
 * `h1` and card titles, and a component that silently picked `h2` everywhere
 * is how a screen ends up with an outline that skips a level in one place and
 * repeats one in another.
 */
export function GroupHeading({
  as: Tag = 'h2',
  children,
  action,
  className,
}: {
  as?: 'h2' | 'h3';
  children: React.ReactNode;
  /** Optional trailing control, e.g. a count or a "See all". */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3 px-1', className)}>
      <Tag className="text-caption font-bold uppercase tracking-wider text-foreground-subtle">
        {children}
      </Tag>
      {action}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── surfaces ── */

/**
 * The card every one of these screens is built from.
 *
 * `rail` paints a 3px accent stripe down the left edge — the reference uses it
 * for the one row that needs the customer to do something, and it is
 * deliberately the only card treatment that differs. A red border all the way
 * round would make a failed payment shout from every edge of the card; a rail
 * points at it.
 */
export function SurfaceCard({
  rail,
  as: Tag = 'div',
  children,
  className,
}: {
  rail?: 'danger' | 'primary';
  as?: 'div' | 'article' | 'section';
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tag
      className={cn(
        'relative overflow-hidden rounded-2xl border border-border bg-surface shadow-sm',
        // `border-l-4` rather than an absolutely-positioned stripe: the rail is
        // literally the card's left border, so it can never drift out of
        // alignment with a rounded corner or overlap the content inside it.
        rail === 'danger' && 'border-l-4 border-l-destructive',
        rail === 'primary' && 'border-l-4 border-l-primary',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/**
 * The recessed band inside a card — a price strip, a diagnostics block, a
 * summary. `bg-sunken` is the light theme's one step DOWN from a white card,
 * and the only elevation move available on a pure-white canvas.
 */
export function InsetPanel({
  children,
  onDark = false,
  className,
}: {
  children: React.ReactNode;
  onDark?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-xl p-3',
        onDark ? 'bg-ink-900 ring-1 ring-inset ring-ink-800' : 'bg-sunken',
        className,
      )}
    >
      {children}
    </div>
  );
}
