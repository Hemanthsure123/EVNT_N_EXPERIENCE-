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
 * "from ₹499" pricing. `null` means ticketing hasn't populated the denormal yet
 * (the backend column is nullable), which is NOT the same as free — so it
 * returns null and the card simply omits the price.
 */
export function formatFromPrice(minorUnits: number | null | undefined): string | null {
  if (minorUnits === null || minorUnits === undefined) return null;
  if (minorUnits === 0) return 'Free';
  const rupees = minorUnits / 100;
  const rounded = Number.isInteger(rupees) ? rupees : Number(rupees.toFixed(2));
  return `${RUPEES}${rounded.toLocaleString(LOCALE)}`;
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
  const rupees = minorUnits / 100;
  const rounded = Number.isInteger(rupees) ? rupees : Number(rupees.toFixed(2));
  return `${RUPEES}${rounded.toLocaleString(LOCALE)}`;
}

/** The `datetime` attribute for a <time> element. */
export const machineDate = (iso: string) => new Date(iso).toISOString();
