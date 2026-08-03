import { describe, expect, it } from 'vitest';
import { canSubmit, submitBlockers } from './submit-gate';
import type { EventRow } from '@/lib/api/organizer';

/**
 * The reported bug, pinned.
 *
 * An organizer could not submit events for approval — and the reason was not
 * that the server was wrong. Their draft had zero ticket types, so the server
 * refused it correctly; what was broken was that the bulk bar OFFERED the
 * button anyway, because it mirrored `status` and nothing else. Every case
 * below is one of the server's gates, and the point of the file is that
 * `canSubmit` cannot silently drift away from them again.
 */

const row = (over: Partial<EventRow> = {}): EventRow =>
  ({
    id: 'e1',
    title: 'Sufi Evening',
    status: 'draft',
    venue: 'Arena',
    city: 'Mumbai',
    starts_at: new Date(Date.now() + 86_400_000).toISOString(),
    ends_at: null,
    poster_url: '',
    organization_id: 'o1',
    organization_name: 'Groove Collective',
    organization_verified_level: 'verified',
    ticket_type_count: 1,
    capacity: 100,
    sold: 0,
    revenue_minor: 0,
    checkins: 0,
    from_price_minor: 50000,
    tickets_available: 100,
    version: 1,
    created_at: new Date().toISOString(),
    moderation_note: '',
    submitted_at: null,
    ...over,
  }) as EventRow;

describe('canSubmit', () => {
  it('allows a complete draft under a verified organisation', () => {
    expect(canSubmit(row())).toBe(true);
    expect(submitBlockers(row())).toEqual([]);
  });

  it('allows a rejected event to be resubmitted', () => {
    expect(canSubmit(row({ status: 'rejected' }))).toBe(true);
  });

  it('refuses a draft with no ticket type — THE REPORTED BUG', () => {
    // The exact shape of the user's event: verified org, everything filled in,
    // and zero tiers. The bulk bar used to offer Submit here and eat a 409.
    const zeroTiers = row({ ticket_type_count: 0, from_price_minor: null, capacity: 0 });
    expect(canSubmit(zeroTiers)).toBe(false);
    expect(submitBlockers(zeroTiers)).toContain('Add at least one ticket type.');
  });

  it('counts tier ROWS, not seats — a zero-quantity tier still satisfies the server', () => {
    // `capacity` is the sum of quantities, so a tier with quantity 0 sums to
    // zero while being a real row the publish gate accepts. Gating on capacity
    // would refuse a publish the server would have allowed.
    expect(canSubmit(row({ ticket_type_count: 1, capacity: 0 }))).toBe(true);
  });

  it('refuses an unverified organisation, and names it', () => {
    const unverified = row({ organization_verified_level: 'unverified' });
    expect(canSubmit(unverified)).toBe(false);
    expect(submitBlockers(unverified)[0]).toContain('Groove Collective');
  });

  it('distinguishes "still being verified" from "not verified"', () => {
    expect(submitBlockers(row({ organization_verified_level: 'pending' }))[0]).toContain(
      'still being verified',
    );
    expect(submitBlockers(row({ organization_verified_level: 'unverified' }))[0]).toContain(
      'needs to be verified',
    );
  });

  it('refuses an event whose start time has passed', () => {
    // A draft decays: left alone long enough it becomes unpublishable purely
    // because its date went by, and nothing else on the screen says so.
    const past = row({ starts_at: new Date(Date.now() - 60_000).toISOString() });
    expect(canSubmit(past)).toBe(false);
    expect(submitBlockers(past)).toContain('The start time has already passed.');
  });

  it('refuses a live or pending event', () => {
    expect(canSubmit(row({ status: 'live' }))).toBe(false);
    expect(canSubmit(row({ status: 'pending_review' }))).toBe(false);
  });

  it('reports every blocker at once, not just the first', () => {
    const broken = row({
      organization_verified_level: 'unverified',
      ticket_type_count: 0,
      venue: '',
      starts_at: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(submitBlockers(broken).length).toBeGreaterThanOrEqual(4);
  });
});
