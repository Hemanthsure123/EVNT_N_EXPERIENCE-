import { describe, expect, it } from 'vitest';
import {
  MIN_AGE_YEARS,
  ageOn,
  changedFields,
  formFromUser,
  profileCompleteness,
  validateProfile,
  type ProfileForm,
} from './profile-form';

const EMPTY: ProfileForm = {
  fullName: '',
  phone: '',
  dateOfBirth: '',
  gender: '',
  genderSelfDescribed: '',
};

const form = (over: Partial<ProfileForm> = {}): ProfileForm => ({ ...EMPTY, ...over });

/** Local noon, so a test can never be flipped by a timezone offset applied to
 *  midnight — the exact class of bug `ageOn` exists to avoid. */
const on = (iso: string) => new Date(`${iso}T12:00:00`);

describe('age', () => {
  it('counts whole years', () => {
    expect(ageOn('1996-06-15', on('2026-08-08'))).toBe(30);
  });

  it('is a year lower the day BEFORE the birthday', () => {
    // `(today - born) / 365` gets this wrong for anybody with enough leap
    // years behind them — and this platform prints "18+" next to events.
    expect(ageOn('1996-08-09', on('2026-08-08'))).toBe(29);
  });

  it('ticks over ON the birthday', () => {
    expect(ageOn('1996-08-08', on('2026-08-08'))).toBe(30);
  });

  it('handles a 29 February birthday', () => {
    // A real date real people have, and the one the naive arithmetic misses.
    expect(ageOn('2000-02-29', on('2026-02-28'))).toBe(25);
    expect(ageOn('2000-02-29', on('2026-03-01'))).toBe(26);
  });

  it('does not shift the date by a timezone', () => {
    // `new Date('1996-06-15')` is UTC MIDNIGHT, which in IST is the evening of
    // the 14th — so every birthday would land a day early. Parsed by hand for
    // exactly that reason.
    expect(ageOn('1996-06-15', on('2026-06-15'))).toBe(30);
  });

  it('is null for anything that is not a date', () => {
    expect(ageOn('')).toBeNull();
    expect(ageOn('yesterday')).toBeNull();
    expect(ageOn('1996-02-31')).toBeNull();
  });
});

describe('validation', () => {
  it('accepts an empty form — none of this is required', () => {
    expect(validateProfile(EMPTY)).toEqual({});
  });

  it('refuses a future date by naming the problem', () => {
    const errors = validateProfile(form({ dateOfBirth: '2030-01-01' }), on('2026-08-08'));
    expect(errors.dateOfBirth).toMatch(/future/i);
  });

  it('refuses somebody under thirteen, and says why in their terms', () => {
    const errors = validateProfile(form({ dateOfBirth: '2020-01-01' }), on('2026-08-08'));
    expect(errors.dateOfBirth).toContain(String(MIN_AGE_YEARS));
  });

  it('catches a mistyped year rather than storing it', () => {
    const errors = validateProfile(form({ dateOfBirth: '1823-04-02' }), on('2026-08-08'));
    expect(errors.dateOfBirth).toMatch(/century/i);
  });

  it('requires words behind "prefer to self-describe"', () => {
    // An option with nowhere to type is worse than no option at all.
    const errors = validateProfile(form({ gender: 'self_described', genderSelfDescribed: '  ' }));
    expect(errors.genderSelfDescribed).toBeTruthy();
  });

  it('asks nothing extra of the other answers', () => {
    expect(validateProfile(form({ gender: 'prefer_not_to_say' }))).toEqual({});
  });
});

describe('the diff', () => {
  it('is null when nothing moved', () => {
    // So a save that changed nothing writes no audit row and makes no request.
    expect(changedFields(EMPTY, EMPTY)).toBeNull();
  });

  it('sends ONLY what moved', () => {
    // Partial by omission: a screen that changes a name must not re-assert a
    // gender the person never opened.
    const before = form({ fullName: 'Asha', gender: 'woman' });
    const after = form({ fullName: 'Asha Rao', gender: 'woman' });
    expect(changedFields(before, after)).toEqual({ full_name: 'Asha Rao' });
  });

  it('clears a date with NULL, not an empty string', () => {
    // The one field whose empty value is null, because it is a date — `''`
    // would be a 400.
    const before = form({ dateOfBirth: '1996-06-15' });
    expect(changedFields(before, EMPTY)).toEqual({ date_of_birth: null });
  });

  it('clears a phone with an empty string, which is how SMS is opted out of', () => {
    const before = form({ phone: '+91 98765 43210' });
    expect(changedFields(before, EMPTY)).toEqual({ phone: '' });
  });

  it('sends the self-description alongside a gender change', () => {
    // The server clears the text for any answer but self-describe, so the pair
    // travels together — otherwise the two ends disagree about a field the
    // person believes they removed.
    const after = form({ gender: 'self_described', genderSelfDescribed: 'Genderfluid' });
    expect(changedFields(EMPTY, after)).toEqual({
      gender: 'self_described',
      gender_self_described: 'Genderfluid',
    });
  });

  it('sends a re-typed self-description on its own', () => {
    const before = form({ gender: 'self_described', genderSelfDescribed: 'Genderfluid' });
    const after = form({ gender: 'self_described', genderSelfDescribed: 'Agender' });
    expect(changedFields(before, after)).toEqual({ gender_self_described: 'Agender' });
  });

  it('treats a whitespace-only edit as no edit', () => {
    expect(changedFields(form({ fullName: 'Asha' }), form({ fullName: '  Asha  ' }))).toBeNull();
  });

  it('round-trips a user through the form unchanged', () => {
    const user = {
      full_name: 'Asha Rao',
      phone: '+91 98765 43210',
      date_of_birth: '1996-06-15',
      gender: 'woman' as const,
      gender_self_described: '',
    };
    expect(changedFields(formFromUser(user), formFromUser(user))).toBeNull();
  });
});

describe('completeness', () => {
  const full = {
    full_name: 'Asha Rao',
    phone: '+91 98765 43210',
    date_of_birth: '1996-06-15',
    gender: 'woman' as const,
    avatar_url: 'https://cdn.example.com/a.jpg',
  };

  it('is 1 when everything is filled in', () => {
    expect(profileCompleteness(full).ratio).toBe(1);
    expect(profileCompleteness(full).missing).toEqual([]);
  });

  it('counts only what the platform actually uses', () => {
    // Five checks. `email` is deliberately not one — it is always present, so
    // counting it would inflate every score by a fifth for free.
    expect(profileCompleteness(full).total).toBe(5);
  });

  it('says what is missing and WHY, in the order worth doing', () => {
    const { missing } = profileCompleteness({
      full_name: '',
      phone: '',
      date_of_birth: null,
      gender: '',
    });
    expect(missing[0]!.key).toBe('full_name');
    expect(missing[0]!.why).toMatch(/ticket/i);
  });

  it('counts "prefer not to say" as answered', () => {
    // It IS an answer. A meter that refuses to move for it is a meter arguing
    // with somebody who declined.
    const { missing } = profileCompleteness({ ...full, gender: 'prefer_not_to_say' });
    expect(missing).toEqual([]);
  });

  it('does not count a whitespace-only name', () => {
    const { missing } = profileCompleteness({ ...full, full_name: '   ' });
    expect(missing.map((entry) => entry.key)).toEqual(['full_name']);
  });
});
