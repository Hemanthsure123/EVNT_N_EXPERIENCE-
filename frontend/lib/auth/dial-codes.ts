/**
 * Country dialling codes for the phone sign-in field.
 *
 * ── WHY A SELECTOR AND NOT A HINT ─────────────────────────────────────────
 *
 * The field used to be one `tel` input with "Include the country code, e.g.
 * +91 98765 43210" underneath it. That is a fine instruction on a keyboard and
 * a poor one on a phone, where `+` lives behind a symbols key on the numeric
 * pad — so the most common outcome is a number typed without it, which is not
 * a number the OTP endpoint can send to. Splitting the code out means the
 * keypad only ever has to produce digits.
 *
 * ── WHY THE LIST IS SHORT ─────────────────────────────────────────────────
 *
 * This is an Indian ticketing platform: the overwhelming majority of numbers
 * are +91, and the rest belong to visitors and to the diaspora buying tickets
 * for people at home. A 200-row list would push India off the first screen of
 * a native picker on the exact device where the field matters most, in
 * exchange for entries nobody selects.
 *
 * These are facts (ITU-T E.164 assignments), not curation — but the CHOICE of
 * which to show is curation, so it is here in code where it can be read, and
 * not derived from anything that would imply a coverage claim we cannot make.
 * Anyone whose code is missing can still type the full number: `toE164` takes
 * a pasted or typed `+` prefix and uses it verbatim.
 */
export type DialCode = {
  /** E.164 country calling code, with its leading `+`. */
  readonly code: string;
  /** ISO 3166-1 alpha-2, used only as a stable React key. */
  readonly iso: string;
  readonly name: string;
};

export const DIAL_CODES: readonly DialCode[] = [
  { code: '+91', iso: 'IN', name: 'India' },
  { code: '+971', iso: 'AE', name: 'United Arab Emirates' },
  { code: '+65', iso: 'SG', name: 'Singapore' },
  { code: '+44', iso: 'GB', name: 'United Kingdom' },
  { code: '+1', iso: 'US', name: 'United States & Canada' },
  { code: '+61', iso: 'AU', name: 'Australia' },
  { code: '+60', iso: 'MY', name: 'Malaysia' },
  { code: '+966', iso: 'SA', name: 'Saudi Arabia' },
  { code: '+974', iso: 'QA', name: 'Qatar' },
  { code: '+968', iso: 'OM', name: 'Oman' },
  { code: '+973', iso: 'BH', name: 'Bahrain' },
  { code: '+965', iso: 'KW', name: 'Kuwait' },
  { code: '+94', iso: 'LK', name: 'Sri Lanka' },
  { code: '+977', iso: 'NP', name: 'Nepal' },
  { code: '+880', iso: 'BD', name: 'Bangladesh' },
  { code: '+49', iso: 'DE', name: 'Germany' },
  { code: '+33', iso: 'FR', name: 'France' },
  { code: '+64', iso: 'NZ', name: 'New Zealand' },
];

export const DEFAULT_DIAL_CODE = '+91';

/**
 * Compose what the user selected and typed into one E.164 number.
 *
 * Four things people actually do, each of which produced an unsendable number
 * before this existed:
 *
 * - Paste a full international number into the national box. A leading `+`
 *   means they have already answered the question the selector asks, so the
 *   selector is ignored rather than prepended on top of it.
 * - Type the trunk prefix: `098765 43210`. A leading zero is a DOMESTIC
 *   dialling artefact and is never part of the international form.
 * - Type the country code again without the plus: `9198765…` under `+91`.
 * - Type spaces, dashes and brackets, none of which E.164 carries.
 *
 * Returns an empty string for empty input, so a caller can tell "nothing typed"
 * from "a number", and never invents digits it was not given.
 */
export function toE164(dialCode: string, national: string): string {
  const typed = national.trim();
  if (!typed) return '';

  // Already international: their `+` wins over the selector.
  if (typed.startsWith('+')) return `+${typed.slice(1).replace(/\D/g, '')}`;

  let digits = typed.replace(/\D/g, '');
  if (!digits) return '';

  // A trunk prefix is a domestic convenience; E.164 has no room for it.
  digits = digits.replace(/^0+/, '');

  // Guard the double-country-code case, but ONLY when what remains is still
  // long enough to be a subscriber number — a Bahraini number legitimately
  // starts with 973, and stripping it there would silently mangle it.
  const bare = dialCode.replace('+', '');
  if (digits.startsWith(bare) && digits.length - bare.length >= 7) {
    digits = digits.slice(bare.length);
  }

  return `${dialCode}${digits}`;
}
