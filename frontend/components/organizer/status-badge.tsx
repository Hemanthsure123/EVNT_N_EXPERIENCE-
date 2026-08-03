'use client';

import * as React from 'react';
import type { EventRow, EventStatus } from '@/lib/api/organizer';
import { eventBadge } from '@/lib/organizer/event-status';
import { StatusPill, type Tone } from './primitives';

/**
 * The event badge, in one place.
 *
 * Thin on purpose — `eventBadge` already owns the rule (including deriving
 * "sold out" and "selling fast" from the authoritative tier counters). This
 * exists so five surfaces render it identically instead of each calling
 * `eventBadge` and picking their own pill.
 *
 * All three badges below take their colour from `StatusPill`'s five tones, so
 * a status means the same hue in a table, in a card and in the ⌘K palette. The
 * tone names are imported rather than re-declared — three private copies of
 * the same union is how two of them end up one tone short of the third.
 */
export function StatusBadge({
  status,
  capacity = 0,
  sold = 0,
}: {
  status: EventStatus;
  capacity?: number;
  sold?: number;
}) {
  const badge = eventBadge({ status, capacity, sold } as Pick<
    EventRow,
    'status' | 'capacity' | 'sold'
  >);
  return <StatusPill tone={badge.tone}>{badge.label}</StatusPill>;
}

/**
 * The booking badge.
 *
 * `reserved` renders as "Holding" rather than "Reserved", because from the
 * organizer's side the interesting fact is that the inventory is held and the
 * money is not in — and that hold expires. The four values here are the whole
 * of `BookingStatus`; there is no fifth.
 */
const BOOKING: Record<string, { label: string; tone: Tone }> = {
  paid: { label: 'Paid', tone: 'success' },
  reserved: { label: 'Holding', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
};

export function BookingBadge({ status }: { status: string }) {
  const badge = BOOKING[status] ?? { label: status, tone: 'neutral' as const };
  return <StatusPill tone={badge.tone}>{badge.label}</StatusPill>;
}

/**
 * The settlement badge.
 *
 * Three stored states, and the labels say what they mean for the organizer's
 * money rather than repeating the enum: `pending` is money they will get,
 * `failed` is money they are still owed after a failed transfer — which is a
 * very different thing from money that is gone, and the label must not imply
 * otherwise.
 */
const SETTLEMENT: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Awaiting release', tone: 'info' },
  paid: { label: 'Paid out', tone: 'success' },
  failed: { label: 'Transfer failed — still owed', tone: 'danger' },
  zero: { label: 'Nothing to pay', tone: 'neutral' },
};

export function SettlementBadge({ status }: { status: string }) {
  const badge = SETTLEMENT[status] ?? { label: status, tone: 'neutral' as const };
  return <StatusPill tone={badge.tone}>{badge.label}</StatusPill>;
}
