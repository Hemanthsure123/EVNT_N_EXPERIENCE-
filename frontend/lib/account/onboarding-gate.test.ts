import { describe, expect, it } from 'vitest';
import { needsOnboarding } from '@/lib/api/profile';
import type { User } from '@/lib/api/types';

/**
 * When the welcome flow opens, and — far more importantly — when it does not.
 *
 * Every case below is one where showing it would be wrong, and three of the
 * four are wrong in the same expensive way: a form standing between somebody
 * and a ticket they came to buy. The gate is three conditions and each rules
 * out exactly one of them.
 */

const user = (over: Partial<User> = {}): User =>
  ({
    id: 'u1',
    email: 'asha@example.com',
    full_name: '',
    phone: '',
    avatar_url: '',
    date_of_birth: null,
    age: null,
    gender: '',
    gender_self_described: '',
    gender_display: '',
    onboarding_completed_at: null,
    is_organizer: false,
    is_staff: false,
    email_verified: true,
    date_joined: '2026-08-01T00:00:00Z',
    ...over,
  }) as User;

describe('when the welcome flow opens', () => {
  it('opens for a verified account that has not answered it', () => {
    expect(needsOnboarding(user())).toBe(true);
  });

  it('does NOT open for somebody who is not signed in', () => {
    expect(needsOnboarding(null)).toBe(false);
    expect(needsOnboarding(undefined)).toBe(false);
  });

  it('does NOT open before the address is proven', () => {
    // The flow sits AFTER verification, not beside it. Somebody staring at a
    // "check your email" screen does not also need a profile form.
    expect(needsOnboarding(user({ email_verified: false }))).toBe(false);
  });

  it('does NOT open again once it has been answered', () => {
    expect(needsOnboarding(user({ onboarding_completed_at: '2026-08-02T09:00:00Z' }))).toBe(
      false,
    );
  });

  it('treats a SKIP as answered', () => {
    // The mark is set by `POST /auth/me/onboarding`, which is what a skip
    // calls — so a skipped flow looks exactly like a completed one from here.
    // Re-prompting somebody who declined is nagging, and nagging on the way to
    // a ticket is how a product loses the people who only wanted a ticket.
    const skipped = user({ onboarding_completed_at: '2026-08-02T09:00:00Z' });
    expect(skipped.full_name).toBe('');
    expect(needsOnboarding(skipped)).toBe(false);
  });

  it('does not care whether anything was actually filled in', () => {
    // The mark is the only signal. Deriving "needs onboarding" from empty
    // fields would re-open the flow forever for anybody who genuinely does not
    // want to give a name — which is a supported choice.
    const answeredButEmpty = user({
      onboarding_completed_at: '2026-08-02T09:00:00Z',
      full_name: '',
      date_of_birth: null,
      gender: '',
    });
    expect(needsOnboarding(answeredButEmpty)).toBe(false);
  });
});
