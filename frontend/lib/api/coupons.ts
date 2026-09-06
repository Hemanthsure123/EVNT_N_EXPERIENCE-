import { api } from './client';

/**
 * An organization's promotional codes.
 *
 * The list hangs off the ORGANIZATION rather than off an event, because a
 * promoter running a season wants one code across it — `event_id` narrows a
 * coupon to one event when they want the opposite, and null means "any event
 * of ours". Same shape as the crew roster, for the same reason.
 *
 * ── THE ORGANIZER FUNDS THE DISCOUNT ─────────────────────────────────────
 *
 * Which is why nothing here asks who pays: there is one answer. The platform
 * fee is charged on the DISCOUNTED subtotal and the organizer's payout shrinks
 * with the discount, automatically. A platform-funded campaign is a genuinely
 * different product and is not built.
 */

export type CouponKind = 'percent' | 'fixed';

export type Coupon = {
  id: string;
  /** Null means every event this organization runs. */
  event_id: string | null;
  /** Stored and compared UPPER-CASE. */
  code: string;
  kind: CouponKind;
  /** A whole percent when `kind` is `percent`, otherwise minor units. */
  value: number;
  /** A ceiling on a PERCENTAGE, in minor units. Null means none. */
  max_discount_minor: number | null;
  starts_at: string | null;
  ends_at: string | null;
  /** Total redemptions across everybody. Null is unlimited. */
  max_redemptions: number | null;
  max_per_user: number;
  /** Whether the checkout may ADVERTISE it. False is the default: the
   *  commonest use is a private code given to a partner. */
  visible_at_checkout: boolean;
  is_active: boolean;
  /** Aggregated server-side for the whole page in one query, never per row. */
  redeemed_count: number;
  created_at: string;
  updated_at: string;
};

export type CouponInput = {
  code: string;
  kind: CouponKind;
  value: number;
  max_discount_minor?: number | null;
  starts_at?: string | null;
  ends_at?: string | null;
  max_redemptions?: number | null;
  max_per_user?: number;
  visible_at_checkout?: boolean;
  event_id?: string | null;
};

const list = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/coupons`;

export const fetchCoupons = (organizationId: string) =>
  api.get<{ data: Coupon[] }>(list(organizationId)).then((page) => page.data);

export const createCoupon = (organizationId: string, input: CouponInput) =>
  api.post<Coupon>(list(organizationId), input);

/**
 * Edit the terms.
 *
 * THE TERMS STAY EDITABLE AFTER REDEMPTIONS and the CODE does not — each
 * redemption recorded what it actually took off, so changing 20% to 10%
 * tomorrow cannot rewrite what somebody paid today, but renaming a code breaks
 * every printed copy of it while the history keeps pointing at something nobody
 * can now type. The server refuses that with a message naming the alternative;
 * show it verbatim.
 */
export const updateCoupon = (
  organizationId: string,
  couponId: string,
  changes: Partial<CouponInput> & { is_active?: boolean },
) => api.patch<Coupon>(`${list(organizationId)}/${encodeURIComponent(couponId)}`, changes);

/**
 * Delete an UNUSED coupon.
 *
 * Refused with a `422 invalid_coupon` once anybody has redeemed it — the
 * redemption is a financial record and the bookings that used it keep their
 * reason for costing less. The message names switching it off instead.
 */
export const deleteCoupon = (organizationId: string, couponId: string) =>
  api.delete<void>(`${list(organizationId)}/${encodeURIComponent(couponId)}`);
