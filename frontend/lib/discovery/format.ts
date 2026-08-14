/**
 * Display formatting for money and dates.
 *
 * Money arrives in MINOR units (paise) from the backend — it is never a float
 * anywhere in this codebase. Dates are formatted in a fixed platform timezone
 * (IST) so a server render and the browser's hydration agree exactly; see
 * date-windows.ts for the same reasoning.
 */

const TIME_ZONE = 'Asia/Kolkata';
const LOCALE = 'en-IN';

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

const timeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const dayNumberFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  day: 'numeric',
});

const monthFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  month: 'short',
});

const longDateFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** "Sat, 2 Aug" */
export const formatEventDate = (iso: string) => dateFormatter.format(new Date(iso));

/** "7:30 pm" */
export const formatEventTime = (iso: string) => timeFormatter.format(new Date(iso));

/** "Sat, 2 Aug · 7:30 pm" */
export const formatEventDateTime = (iso: string) =>
  `${formatEventDate(iso)} · ${formatEventTime(iso)}`;

/** "Saturday, 2 August 2026" — for the detail route and JSON-LD-adjacent copy. */
export const formatEventDateLong = (iso: string) => longDateFormatter.format(new Date(iso));

/** { day: "2", month: "Aug" } — the date medallion on a card. */
export function formatDateParts(iso: string): { day: string; month: string } {
  const date = new Date(iso);
  return { day: dayNumberFormatter.format(date), month: monthFormatter.format(date) };
}

const RUPEES = '₹';

/**
 * Rupees from minor units, with paise shown as TWO digits or not at all.
 *
 * ── WHY NOT `Number(x.toFixed(2)).toLocaleString()` ───────────────────────
 *
 * That was the old body, and it printed a settlement of 60980 paise as
 * "₹609.8". `toFixed(2)` produces the string "609.80", wrapping it in
 * `Number()` parses it straight back to the number 609.8, and the trailing zero
 * is gone before `toLocaleString` ever sees it. Money with one decimal place is
 * not a rounding nicety -- it reads as a typo on the one screen where an
 * organizer is checking what they are owed.
 *
 * Whole rupees stay whole: a ₹500 ticket is "₹500", not "₹500.00". The choice is
 * made from the VALUE, and the digit count is then pinned at both ends so
 * `toLocaleString` cannot drop it again.
 */
function rupees(minorUnits: number): string {
  const value = minorUnits / 100;
  const digits = Number.isInteger(value) ? 0 : 2;
  // The sign goes OUTSIDE the symbol. Prepending "₹" to an already-signed
  // number gave "₹-609.80"; a settlement `net` is a signed integer (refunds can
  // exceed captures), so this is reachable on the payouts screen rather than
  // theoretical.
  const sign = value < 0 ? '-' : '';
  return `${sign}${RUPEES}${Math.abs(value).toLocaleString(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/**
 * "from ₹499" pricing. `null` means ticketing hasn't populated the denormal yet
 * (the backend column is nullable), which is NOT the same as free — so it
 * returns null and the card simply omits the price.
 */
export function formatFromPrice(minorUnits: number | null | undefined): string | null {
  if (minorUnits === null || minorUnits === undefined) return null;
  if (minorUnits === 0) return 'Free';
  return rupees(minorUnits);
}

/**
 * Plain money, in minor units. Zero is "₹0", not "Free".
 *
 * `formatFromPrice` deliberately renders 0 as "Free", which is correct for a
 * TICKET PRICE and wrong for every other amount — a revenue tile reading
 * "Free" on a quiet morning is nonsense. Anything that is a sum rather than a
 * price uses this.
 */
export function formatMoney(minorUnits: number | null | undefined): string {
  if (minorUnits === null || minorUnits === undefined) return '—';
  return rupees(minorUnits);
}

/** The `datetime` attribute for a <time> element. */
export const machineDate = (iso: string) => new Date(iso).toISOString();
