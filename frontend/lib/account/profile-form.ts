/**
 * The profile form's rules, as a pure module.
 *
 * ── WHY THESE ARE NOT IN THE COMPONENT ────────────────────────────────────
 *
 * Every rule below fails in a way that is invisible by looking at a form that
 * renders: a birthday that is a day out because of a leap year, a diff that
 * sends a field nobody touched, an age that is right today and wrong tomorrow.
 * Same reasoning as `lib/discovery/calendar.ts` and `anchored-position.ts` —
 * the arithmetic is the part with edge cases, so the arithmetic is the part
 * with tests.
 *
 * ── THE DIFF IS THE POINT ─────────────────────────────────────────────────
 *
 * `PATCH /auth/me` is partial by omission, so sending the whole form on every
 * save would mean a settings screen that changes a name also re-asserts a
 * gender the person never opened. `changedFields` sends only what moved, which
 * is what makes an unrelated concurrent edit survive.
 */

import type { ProfileUpdate } from '@/lib/api/profile';
import type { Gender, User } from '@/lib/api/types';

/** `MIN_AGE_YEARS` / `MAX_AGE_YEARS` in `apps/accounts/schemas.py`, mirrored so
 *  the form refuses what the server would rather than surfacing a 400. */
export const MIN_AGE_YEARS = 13;
export const MAX_AGE_YEARS = 120;

export const GENDER_OPTIONS: readonly { value: Gender; label: string }[] = [
  { value: 'woman', label: 'Woman' },
  { value: 'man', label: 'Man' },
  { value: 'non_binary', label: 'Non-binary' },
  { value: 'self_described', label: 'Prefer to self-describe' },
  // Last, and it IS an option rather than an absence: choosing it records that
  // the question was asked and declined, which is what stops the welcome flow
  // asking again. Leaving the field untouched is the different state.
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

/** What the form holds while it is being edited. Strings throughout, because
 *  that is what inputs yield — the conversion happens at the boundary. */
export type ProfileForm = {
  fullName: string;
  phone: string;
  /** `yyyy-mm-dd`, the value a native date input gives. `''` means none. */
  dateOfBirth: string;
  gender: Gender | '';
  genderSelfDescribed: string;
};

export function formFromUser(user: Pick<
  User,
  'full_name' | 'phone' | 'date_of_birth' | 'gender' | 'gender_self_described'
>): ProfileForm {
  return {
    fullName: user.full_name ?? '',
    phone: user.phone ?? '',
    dateOfBirth: user.date_of_birth ?? '',
    gender: user.gender ?? '',
    genderSelfDescribed: user.gender_self_described ?? '',
  };
}

/**
 * Whole years, counting the birthday correctly.
 *
 * `(today - born) / 365` is the version everybody writes and it drifts by a
 * day per leap year — so somebody's age flips early, on a platform that shows
 * "18+" next to events. This is the same comparison the server makes.
 */
export function ageOn(iso: string, today: Date = new Date()): number | null {
  const born = parseIsoDate(iso);
  if (!born) return null;
  const y = today.getFullYear() - born.year;
  const beforeBirthday =
    today.getMonth() + 1 < born.month ||
    (today.getMonth() + 1 === born.month && today.getDate() < born.day);
  return y - (beforeBirthday ? 1 : 0);
}

/** `yyyy-mm-dd` → its parts, or null. Parsed by hand rather than with `new
 *  Date(iso)`: that constructor reads a bare date as UTC MIDNIGHT, so in IST
 *  it lands on the previous evening and every birthday is a day early. */
function parseIsoDate(iso: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Round-trip through a UTC date to reject 31 February, which passes the
  // range check above and is not a day.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

export type FieldErrors = Partial<Record<keyof ProfileForm, string>>;

/**
 * What is wrong with the form, in the person's terms.
 *
 * Only the two fields with real constraints are checked. A name and a phone
 * number have none worth enforcing here — the server takes a phone loosely on
 * purpose, because Indian numbers arrive with and without +91, with spaces and
 * occasionally with a leading zero, and a strict pattern rejects real numbers.
 */
export function validateProfile(form: ProfileForm, today: Date = new Date()): FieldErrors {
  const errors: FieldErrors = {};

  if (form.dateOfBirth) {
    const parsed = parseIsoDate(form.dateOfBirth);
    if (!parsed) {
      errors.dateOfBirth = 'That is not a date.';
    } else {
      const age = ageOn(form.dateOfBirth, today)!;
      if (age < 0) errors.dateOfBirth = 'That date is in the future.';
      else if (age > MAX_AGE_YEARS) {
        errors.dateOfBirth = 'Check the year — that is over a century ago.';
      } else if (age < MIN_AGE_YEARS) {
        errors.dateOfBirth = `You need to be at least ${MIN_AGE_YEARS} to have an account here.`;
      }
    }
  }

  if (form.gender === 'self_described' && !form.genderSelfDescribed.trim()) {
    errors.genderSelfDescribed = 'Tell us how you would like to be described.';
  }

  return errors;
}

/**
 * The subset that actually moved.
 *
 * Returns `null` when nothing did, so a caller can skip the request entirely
 * rather than writing an audit row for a save that changed nothing.
 *
 * `gender_self_described` rides along whenever `gender` moves, even when its
 * own text is unchanged — the server clears it for any answer but
 * self-describe, and sending the pair together is what keeps the two ends
 * agreeing about a field the person believes they removed.
 */
export function changedFields(before: ProfileForm, after: ProfileForm): ProfileUpdate | null {
  const changes: ProfileUpdate = {};

  if (after.fullName.trim() !== before.fullName.trim()) {
    changes.full_name = after.fullName.trim();
  }
  if (after.phone.trim() !== before.phone.trim()) changes.phone = after.phone.trim();
  if (after.dateOfBirth !== before.dateOfBirth) {
    // `null`, not `''`. This is the one field whose empty value is null,
    // because it is a date — an empty string would be a 400.
    changes.date_of_birth = after.dateOfBirth || null;
  }
  if (after.gender !== before.gender) {
    changes.gender = after.gender;
    if (after.gender === 'self_described') {
      changes.gender_self_described = after.genderSelfDescribed.trim();
    }
  } else if (
    after.gender === 'self_described' &&
    after.genderSelfDescribed.trim() !== before.genderSelfDescribed.trim()
  ) {
    changes.gender_self_described = after.genderSelfDescribed.trim();
  }

  return Object.keys(changes).length ? changes : null;
}

/**
 * How complete a profile is, 0-1, and what is still missing.
 *
 * ── IT COUNTS ONLY WHAT THE PLATFORM ACTUALLY USES ────────────────────────
 *
 * A name (it goes on the ticket), a picture, a phone number (SMS delivery),
 * and the two optional details. Nothing else is counted — a meter that only
 * reaches 100% by filling in fields nobody needs is a nag with a progress bar
 * on it, and `email` is always present so counting it would inflate every
 * score by a fifth for free.
 *
 * `prefer_not_to_say` COUNTS as answered. It is an answer, and a meter that
 * refuses to move for it is a meter arguing with somebody who declined.
 */
export type Completeness = {
  ratio: number;
  done: number;
  total: number;
  /** In the order worth doing them, most useful first. */
  missing: { key: string; label: string; why: string }[];
};

export function profileCompleteness(
  user: Pick<User, 'full_name' | 'phone' | 'date_of_birth' | 'gender'> & { avatar_url?: string },
): Completeness {
  const checks = [
    {
      key: 'full_name',
      label: 'Add your name',
      why: 'It is the name printed on every ticket you book.',
      done: Boolean(user.full_name?.trim()),
    },
    {
      key: 'avatar_url',
      label: 'Add a photo',
      why: 'It shows wherever you appear on the platform.',
      done: Boolean(user.avatar_url?.trim()),
    },
    {
      key: 'phone',
      label: 'Add a phone number',
      why: 'Booking confirmations and reminders go out by SMS too.',
      done: Boolean(user.phone?.trim()),
    },
    {
      key: 'date_of_birth',
      label: 'Add your date of birth',
      why: 'Some events have an age policy at the door.',
      done: Boolean(user.date_of_birth),
    },
    {
      key: 'gender',
      label: 'Add how you describe yourself',
      why: 'Optional, and you can say you would rather not.',
      done: Boolean(user.gender),
    },
  ];

  const done = checks.filter((check) => check.done).length;
  return {
    ratio: done / checks.length,
    done,
    total: checks.length,
    missing: checks.filter((check) => !check.done).map(({ key, label, why }) => ({ key, label, why })),
  };
}
