import type { TicketTier } from '@/lib/api/types';

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
  /** `unit price × quantity`, minor units. */
  subtotal: number;
};

export type SelectionTotals = {
  lines: SelectionLine[];
  ticketCount: number;
  /** What the customer pays. There is nothing added on top of this. */
  total: number;
  /**
   * The platform's cut, taken OUT of the total at settlement — NOT a surcharge.
   * Shown for transparency, never added. Adding it would overstate the price by
   * exactly the fee, which on a checkout is not a rounding error, it's a lie.
   */
  platformFee: number;
  /** True when a line asks for more than that tier still has. */
  overAvailable: boolean;
};

/** Matches the backend's `PLATFORM_FEE_PER_TICKET` (paise). */
export const PLATFORM_FEE_PER_TICKET = 10;

export function totalsFor(selection: Selection, tiers: TicketTier[]): SelectionTotals {
  const lines: SelectionLine[] = [];
  for (const line of selection) {
    const tier = tiers.find((candidate) => candidate.id === line.tierId);
    if (!tier) continue; // a tier that vanished between screens simply drops out
    lines.push({ tier, quantity: line.quantity, subtotal: tier.price * line.quantity });
  }
  const ticketCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  return {
    lines,
    ticketCount,
    total: lines.reduce((sum, line) => sum + line.subtotal, 0),
    platformFee: PLATFORM_FEE_PER_TICKET * ticketCount,
    overAvailable: lines.some((line) => line.quantity > line.tier.available),
  };
}

/** The API shape `POST /bookings` expects. */
export const toBookingItems = (selection: Selection) =>
  selection.map((line) => ({ ticket_type_id: line.tierId, quantity: line.quantity }));

/**
 * A stable idempotency key for a selection.
 *
 * Derived from the intent (this event, these tiers, these quantities) rather
 * than randomly generated, so a double-tap, a retry after a dropped connection,
 * and a reload-then-continue all resolve to ONE booking. A random key would
 * make each of those reserve a fresh set of tickets against the same person.
 *
 * The user id is deliberately absent: the backend already scopes the key to the
 * authenticated user, so including it here would only make the key longer.
 */
export function idempotencyKeyFor(eventId: string, selection: Selection): string {
  const normalised = [...selection]
    .sort((a, b) => a.tierId.localeCompare(b.tierId))
    .map((line) => `${line.tierId}:${line.quantity}`)
    .join(',');
  return `book:${eventId}:${normalised}`;
}
