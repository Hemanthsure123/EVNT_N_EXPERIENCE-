import type { TicketTier } from '@/lib/api/types';
import { unitPriceFor } from '@/lib/discovery/tiers';

/**
 * What the user has chosen, and what it costs.
 *
 * THE SELECTION LIVES IN THE URL. Four screens share it, and the alternatives
 * all fail somewhere real: React state dies on refresh, `sessionStorage` can't
 * be linked or restored after a crash, and a server session doesn't exist. A
 * query string survives reload, back/forward, a shared link and a browser
 * restart — which matters most precisely here, because someone who loses their
 * basket at the payment step does not rebuild it.
 *
 * Encoded as `tickets=<tierId>:<qty>,<tierId>:<qty>` — short enough to read in
 * the address bar, and order-preserving so the summary doesn't reshuffle.
 *
 * MONEY IS INTEGER MINOR UNITS end to end, exactly as the backend sends it.
 * Nothing here ever divides by 100 — only the formatter does, once, at render.
 */

export type Selection = { tierId: string; quantity: number }[];

export const SELECTION_PARAM = 'tickets';

export function parseSelection(value: string | null | undefined): Selection {
  if (!value) return [];
  const seen = new Set<string>();
  return value
    .split(',')
    .map((part) => {
      const [tierId, rawQuantity] = part.split(':');
      const quantity = Number(rawQuantity);
      if (!tierId || !Number.isInteger(quantity) || quantity < 1) return null;
      if (seen.has(tierId)) return null;
      seen.add(tierId);
      return { tierId, quantity };
    })
    .filter((entry): entry is { tierId: string; quantity: number } => entry !== null);
}

export const serialiseSelection = (selection: Selection): string =>
  selection
    .filter((line) => line.quantity > 0)
    .map((line) => `${line.tierId}:${line.quantity}`)
    .join(',');

export function setQuantity(selection: Selection, tierId: string, quantity: number): Selection {
  const without = selection.filter((line) => line.tierId !== tierId);
  return quantity > 0 ? [...without, { tierId, quantity }] : without;
}

export const quantityFor = (selection: Selection, tierId: string): number =>
  selection.find((line) => line.tierId === tierId)?.quantity ?? 0;

export type SelectionLine = {
  tier: TicketTier;
  quantity: number;
  /** `unit price × quantity`, minor units — at the tier's EFFECTIVE price. */
  subtotal: number;
  /**
   * What one ticket of this tier costs right now, minor units. Carried on the
   * line so a caller renders the same number the subtotal was built from rather
   * than reaching back into `tier.price`, which is the face price.
   */
  unitPrice: number;
  /**
   * The live sale phase's name, null when this line is at face price. It is the
   * label to show BEFORE a booking exists; once one does, the booking item's own
   * recorded `phase_name` is authoritative.
   */
  phaseName: string | null;
};

export type SelectionTotals = {
  lines: SelectionLine[];
  ticketCount: number;
  /**
   * What the TICKETS cost — the "Order amount" line on the checkout.
   *
   * This used to be the whole charge, because the fee was deducted from the
   * organizer's share rather than added to the customer's bill. It is now one
   * of three terms; `grandTotal` is what a card is debited for. Anything that
   * renders `total` as the price somebody pays is now understating it.
   */
  total: number;
  /**
   * The platform's fee, 1% of `total`, and PART OF `grandTotal`.
   *
   * The old comment here said the opposite — "taken OUT at settlement, NOT a
   * surcharge, adding it would be a lie". That was true of a flat per-ticket fee
   * deducted from the organizer. The fee is charged on top now, the organizer
   * receives the full ticket subtotal, and the number that would be a lie is a
   * total that leaves it out.
   */
  platformFee: number;
  /** What the customer actually pays: tickets + fee (+ any donation). */
  grandTotal: number;
  /** True when a line asks for more than that tier still has. */
  overAvailable: boolean;
};

/**
 * Matches the backend's `PLATFORM_FEE_BPS`. 100 basis points = 1%.
 *
 * Basis points and integer arithmetic on both sides, rounded half up, so this
 * estimate and the amount the lock actually bills agree to the paise. A float
 * percentage here would disagree with Python's integer division on exactly the
 * orders where a customer would notice.
 */
export const PLATFORM_FEE_BPS = 100;

/** The platform fee on a ticket subtotal, in whole paise. */
export const platformFeeFor = (subtotalMinor: number) =>
  Math.floor((subtotalMinor * PLATFORM_FEE_BPS + 5_000) / 10_000);

/**
 * Mirrors the backend's `DONATION_MAX_MINOR`.
 *
 * The server is what actually enforces it — this copy only stops the UI
 * offering an amount that would be refused, which is a better experience than a
 * 400 but is not a security boundary and must never be mistaken for one.
 */
export const DONATION_MAX_MINOR = 100_000;

/**
 * THIS IS AN ESTIMATE, AND IT HAS TO MATCH WHAT THE LOCK WILL CHARGE.
 *
 * It prices every line at `effective_price` — the live sale-phase price — not at
 * the tier's face price. Quoting the face price OVERSTATED a discounted order:
 * somebody choosing two ₹799 Early bird tickets was shown ₹1,998, pressed
 * "Continue", and the booking the backend then created said ₹1,598. A funnel
 * whose first number is wrong about money is the one place that cannot be
 * hand-waved as a display detail.
 *
 * It stays an estimate for a reason this cannot fix: the CHARGE is decided under
 * the tier's row lock, and the straddle rule means an order that does not fit
 * inside the phase's remaining seats bills at the NEXT price for the whole
 * order. So the moment a booking exists the funnel stops using this and reads
 * the booking's own `total_amount` and each item's recorded `unit_price` —
 * which is what every screen after the picker already does.
 */
export function totalsFor(selection: Selection, tiers: TicketTier[]): SelectionTotals {
  const lines: SelectionLine[] = [];
  for (const line of selection) {
    const tier = tiers.find((candidate) => candidate.id === line.tierId);
    if (!tier) continue; // a tier that vanished between screens simply drops out
    const unitPrice = unitPriceFor(tier);
    lines.push({
      tier,
      quantity: line.quantity,
      subtotal: unitPrice * line.quantity,
      unitPrice,
      phaseName: tier.current_phase?.name ?? null,
    });
  }
  const ticketCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const total = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const platformFee = platformFeeFor(total);
  return {
    lines,
    ticketCount,
    total,
    platformFee,
    // No donation term here on purpose: a donation is chosen on the review
    // screen, after this estimate has done its job. The screen that offers it
    // adds it to this number, and the BOOKING's own `total_amount` supersedes
    // all of it the moment one exists.
    grandTotal: total + platformFee,
    overAvailable: lines.some((line) => line.quantity > line.tier.available),
  };
}

/** The API shape `POST /bookings` expects. */
export const toBookingItems = (selection: Selection) =>
  selection.map((line) => ({ ticket_type_id: line.tierId, quantity: line.quantity }));

/**
 * A stable idempotency key for one checkout ATTEMPT at a selection.
 *
 * Derived from the intent (this event, these tiers, these quantities) rather
 * than randomly generated, so a double-tap, a retry after a dropped connection,
 * and a reload-then-continue all resolve to ONE booking. A random key would
 * make each of those reserve a fresh set of tickets against the same person.
 *
 * ── AND THE ATTEMPT, WHICH IS WHY IT IS NOT JUST THE SELECTION ────────────
 *
 * Without it "two General tickets for this event" was the same string for ever,
 * so the key could not tell a RETRY from a SECOND PURCHASE. Buying those two
 * tickets made them permanently unbuyable by that account: the server replayed
 * the settled booking, the checkout showed its stale total, and Pay opened a
 * provider order that had already been captured.
 *
 * `attempt` is STABLE for as long as one checkout is in progress and is bumped
 * only when the booking that came back cannot be paid for — see
 * `lib/booking/attempt.ts`. Every protection the derived key was written for is
 * intact; what changes is that a finished attempt stops speaking for the next.
 *
 * It defaults to 1 so a caller with no attempt store (a test, a server render)
 * produces exactly the key this function produced before attempts existed.
 *
 * The user id is deliberately absent: the backend already scopes the key to the
 * authenticated user, so including it here would only make the key longer.
 */
export function idempotencyKeyFor(
  eventId: string,
  selection: Selection,
  attempt = 1,
): string {
  return `book:${eventId}:${selectionSignature(selection)}:a${attempt}`;
}

/**
 * An order-independent fingerprint of what was chosen.
 *
 * Extracted from `idempotencyKeyFor` so the review screen can ask the one
 * question it could not ask before: **is the booking I am holding still the
 * booking this URL describes?**
 *
 * It could not, and that was a money-path bug. `BookingProvider` lives in the
 * checkout LAYOUT, so the reserved booking survives a trip back to the picker;
 * the reserve effect short-circuits on `|| booking`; and the order lines render
 * from `booking.items`. So changing the quantity and coming forward showed —
 * and charged for — the ORIGINAL selection, with the URL and the picker both
 * saying something else. Nothing failed and nothing said anything.
 *
 * Both signatures are built the same way, from the same sort, so a booking and
 * a selection can never disagree for a reason as trivial as ordering.
 */
export function selectionSignature(selection: Selection): string {
  return [...selection]
    .filter((line) => line.quantity > 0)
    .sort((a, b) => a.tierId.localeCompare(b.tierId))
    .map((line) => `${line.tierId}:${line.quantity}`)
    .join(',');
}

/** The same fingerprint, taken from a booking's own reserved lines. */
export function bookingItemsSignature(
  items: ReadonlyArray<{ ticket_type_id: string; quantity: number }>,
): string {
  return [...items]
    .filter((item) => item.quantity > 0)
    .sort((a, b) => a.ticket_type_id.localeCompare(b.ticket_type_id))
    .map((item) => `${item.ticket_type_id}:${item.quantity}`)
    .join(',');
}
