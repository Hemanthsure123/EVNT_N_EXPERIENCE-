import type { Coupon, CouponKind } from '@/lib/api/coupons';
import { formatMoney } from '@/lib/discovery/format';
import type { Tone } from '@/components/organizer/primitives';

/**
 * How a promotional code READS on the organizer's screen.
 *
 * Pure, and separate from the component for the same reason the calendar
 * arithmetic and the anchored-position maths are: every interesting case here
 * is a boundary — a code that ends today, one whose last use was just taken,
 * one switched off while still inside its window — and none of them is visible
 * by looking at a table that renders.
 *
 * ── THE STATUS IS DERIVED, NEVER STORED ──────────────────────────────────
 *
 * `is_active` is one of four inputs, not the answer. A live-looking pill on a
 * code that has expired or run out is the same class of lie as a health tile
 * that is green because nobody looked — and it is worse here, because the
 * organizer's next move is to hand the code to somebody.
 *
 * ORDER MATTERS. Switched off comes first because it is the only state the
 * organizer chose and the only one they can undo from this screen; expired
 * before exhausted because a code past its date cannot be revived by raising a
 * limit; scheduled last, because a code that has not started yet but is already
 * full is genuinely "fully claimed" rather than "starting soon".
 */
export function couponStatus(
  coupon: Pick<
    Coupon,
    'is_active' | 'starts_at' | 'ends_at' | 'max_redemptions' | 'redeemed_count'
  >,
  now: Date,
): { label: string; tone: Tone } {
  if (!coupon.is_active) return { label: 'Switched off', tone: 'neutral' };
  if (coupon.ends_at && Date.parse(coupon.ends_at) <= now.getTime()) {
    return { label: 'Expired', tone: 'neutral' };
  }
  if (coupon.max_redemptions !== null && coupon.redeemed_count >= coupon.max_redemptions) {
    return { label: 'Fully claimed', tone: 'warning' };
  }
  if (coupon.starts_at && Date.parse(coupon.starts_at) > now.getTime()) {
    return { label: 'Scheduled', tone: 'info' };
  }
  return { label: 'Live', tone: 'success' };
}

/**
 * What the code takes off, in one line.
 *
 * The CEILING is named in the same breath as the percentage. "50% off" that
 * silently becomes ₹50 is exactly the surprise the cap exists to let an
 * organizer set, and a row that shows only the first half describes a coupon
 * they did not make.
 */
export function describeTerms(coupon: Pick<Coupon, 'kind' | 'value' | 'max_discount_minor'>) {
  if (coupon.kind === 'percent') {
    const cap = coupon.max_discount_minor
      ? `, max ${formatMoney(coupon.max_discount_minor)}`
      : '';
    return `${coupon.value}% off${cap}`;
  }
  return `${formatMoney(coupon.value)} off`;
}

/**
 * How much of the code is gone.
 *
 * "12 used" for an unlimited code, "12 / 50" for a bounded one. A denominator
 * that does not exist is not a denominator — writing "12 of ∞" or "12 of 0"
 * would be a fraction describing nothing, on the column an organizer reads to
 * decide whether to send the code to anybody else.
 */
export function describeUsage(coupon: Pick<Coupon, 'redeemed_count' | 'max_redemptions'>) {
  return coupon.max_redemptions === null
    ? `${coupon.redeemed_count} used`
    : `${coupon.redeemed_count} / ${coupon.max_redemptions}`;
}

export type CouponDraft = {
  code: string;
  kind: CouponKind;
  value: string;
  cap: string;
  endsAt: string;
  maxRedemptions: string;
  maxPerUser: string;
  visible: boolean;
  eventId: string;
};

/** A code is retyped off a poster. Same alphabet the server stores. */
const CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;

/**
 * What the form can refuse WITHOUT asking the server.
 *
 * Deliberately a subset. Everything that needs the stored row — a cap surviving
 * a switch to a fixed amount, a code another of your coupons already has — is
 * the server's to decide against the MERGED row, and its sentence is shown
 * verbatim when it does. Restating those rules here would be two statements of
 * one rule, which is how they drift.
 *
 * What IS here is the set somebody can fix while looking at the field: a
 * malformed code, a percentage over 100, an amount of nothing. Refusing those
 * at the boundary means the common mistake never costs a round trip.
 */
export function validateDraft(draft: CouponDraft): string[] {
  const issues: string[] = [];
  const code = draft.code.trim().toUpperCase();

  if (code && !CODE_PATTERN.test(code)) {
    issues.push(
      'A code is 3–32 characters, using letters, numbers, dashes and underscores only.',
    );
  }

  const value = Number(draft.value.replace(/[^\d.]/g, ''));
  if (draft.value.trim() && (!Number.isFinite(value) || value <= 0)) {
    issues.push('A discount of nothing is not a discount.');
  } else if (draft.kind === 'percent' && value > 100) {
    issues.push('A percentage discount is at most 100%.');
  } else if (draft.kind === 'percent' && draft.value.trim() && !Number.isInteger(value)) {
    // Whole percents only. The column is an integer, so "12.5%" would be
    // silently rounded on the way in — and a coupon that does not do what its
    // form said is worse than one that refused to be saved.
    issues.push('Use a whole number of percent.');
  }

  if (draft.kind === 'percent' && draft.cap.trim()) {
    const cap = Number(draft.cap.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(cap) || cap <= 0) {
      issues.push('A maximum of nothing would disable the code.');
    }
  }

  if (draft.maxRedemptions.trim()) {
    const total = Number(draft.maxRedemptions);
    if (!Number.isInteger(total) || total < 1) {
      issues.push('Total uses is a whole number, at least 1. Leave it empty for unlimited.');
    }
  }

  const perUser = Number(draft.maxPerUser);
  if (!Number.isInteger(perUser) || perUser < 1) {
    issues.push('Uses per person is a whole number, at least 1.');
  }

  return issues;
}
