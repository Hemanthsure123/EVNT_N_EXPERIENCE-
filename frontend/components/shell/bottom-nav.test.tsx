import { describe, expect, it } from 'vitest';
import { BOTTOM_NAV_CLEARANCE, isActive } from './bottom-nav';

/**
 * The active-route match is pure, so its edge cases are testable without a
 * router: they are all about path boundaries, which is exactly the class of bug
 * that survives being looked at (`/events` vs `/events/{id}` vs a future
 * `/events-archive`).
 */
describe('isActive', () => {
  it('marks the exact route', () => {
    expect(isActive('/events', '/events')).toBe(true);
  });

  it('marks a child route — an open event is still the Events tab', () => {
    expect(isActive('/events/8f1c-abc', '/events')).toBe(true);
    expect(isActive('/hire/requests/12', '/hire')).toBe(true);
  });

  it('does not treat a sibling with a shared prefix as a child', () => {
    // The trailing slash is the whole reason this passes.
    expect(isActive('/events-archive', '/events')).toBe(false);
  });

  it('does not light Home up on every page', () => {
    expect(isActive('/', '/')).toBe(true);
    expect(isActive('/events', '/')).toBe(false);
    expect(isActive('/cities/mumbai', '/')).toBe(false);
  });

  it('marks nothing when the route is outside the bar', () => {
    for (const href of ['/', '/events', '/saved', '/hire']) {
      expect(isActive('/booking/8f1c/review', href)).toBe(false);
    }
  });
});

describe('BOTTOM_NAV_CLEARANCE', () => {
  /**
   * The bar's height and the safe-area inset it pads itself with have to move
   * together. A clearance that hard-codes `4rem` desynchronises silently the
   * day `--bottom-nav-height` changes, and the failure — a row of links under
   * the bar — is invisible on a desktop monitor.
   */
  it('is expressed with the height token, not a literal', () => {
    expect(BOTTOM_NAV_CLEARANCE).toContain('var(--bottom-nav-height)');
    expect(BOTTOM_NAV_CLEARANCE).toContain('env(safe-area-inset-bottom)');
    expect(BOTTOM_NAV_CLEARANCE).not.toMatch(/\d+rem/);
  });

  it('stops at `md`, where the bar itself stops existing', () => {
    expect(BOTTOM_NAV_CLEARANCE).toContain('md:pb-0');
  });
});
