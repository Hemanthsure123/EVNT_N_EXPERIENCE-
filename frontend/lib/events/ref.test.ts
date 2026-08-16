import { describe, expect, it } from 'vitest';
import { eventPath, eventRefSegment, parseEventRef } from './ref';

const ID = '018f3a2c-1b4d-7c9e-8f21-5a6b7c8d9e0f';

describe('parseEventRef', () => {
  it('reads a bare uuid — the URL shape every existing link uses', () => {
    expect(parseEventRef(ID)).toBe(ID);
  });

  it('reads a slugged ref', () => {
    expect(parseEventRef(`sunburn-arena-2026-${ID}`)).toBe(ID);
  });

  it('takes the LAST uuid when the slug is itself uuid-shaped', () => {
    const other = '0191aaaa-bbbb-cccc-dddd-eeeeffff0000';
    expect(parseEventRef(`${other}-${ID}`)).toBe(ID);
  });

  it('is case-insensitive, because a pasted uuid is often upper-cased', () => {
    expect(parseEventRef(ID.toUpperCase())).toBe(ID.toUpperCase());
  });

  it('rejects anything without a trailing uuid rather than guessing', () => {
    expect(parseEventRef('a-b-c-d-e-f')).toBeNull();
    expect(parseEventRef('sitemap')).toBeNull();
    expect(parseEventRef('')).toBeNull();
    expect(parseEventRef(undefined)).toBeNull();
    expect(parseEventRef(null)).toBeNull();
  });

  it('rejects a uuid glued on with no separator — not a ref we ever emitted', () => {
    expect(parseEventRef(`sunburn${ID}`)).toBeNull();
  });

  it('rejects a truncated uuid', () => {
    expect(parseEventRef(ID.slice(0, -1))).toBeNull();
  });
});

describe('eventRefSegment', () => {
  it('joins the slug and the id', () => {
    expect(eventRefSegment({ id: ID, slug: 'sunburn-arena' })).toBe(`sunburn-arena-${ID}`);
  });

  it('emits the BARE id when there is no slug — never a leading hyphen', () => {
    // A leading "-" would make the canonical segment differ from the one the
    // parser round-trips to, and the page would redirect to itself forever.
    expect(eventRefSegment({ id: ID, slug: '' })).toBe(ID);
    expect(eventRefSegment({ id: ID, slug: null })).toBe(ID);
    expect(eventRefSegment({ id: ID })).toBe(ID);
    expect(eventRefSegment({ id: ID, slug: '   ' })).toBe(ID);
  });
});

describe('eventPath', () => {
  it('is site-relative, so it resolves against metadataBase', () => {
    expect(eventPath({ id: ID, slug: 'jazz-night' })).toBe(`/events/jazz-night-${ID}`);
    expect(eventPath({ id: ID })).toBe(`/events/${ID}`);
  });
});

describe('the round trip', () => {
  // This is the single property that guarantees no shared link can break: a
  // segment we emit always parses back to the id we emitted it for.
  const slugs = [
    '',
    'sunburn-arena-2026',
    'a',
    'new-years-eve-party',
    '2026',
    'deadbeef',
    // What the backend produces for a Devanagari / emoji-only title.
    '',
    // A slug that ends in a digit run, i.e. looks like the start of a uuid.
    'set-018f3a2c',
    'x'.repeat(80),
  ];

  for (const slug of slugs) {
    it(`round-trips ${slug ? `"${slug.slice(0, 24)}"` : '(no slug)'}`, () => {
      expect(parseEventRef(eventRefSegment({ id: ID, slug }))).toBe(ID);
    });
  }
});
