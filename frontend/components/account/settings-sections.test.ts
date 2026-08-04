import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SECTION_ID,
  SETTINGS_SECTIONS,
  contentSectionFor,
  findSection,
  parseSectionId,
  resolveSection,
  sectionHref,
} from './settings-sections';

/**
 * Section resolution.
 *
 * Four rules, and each one fails silently rather than visibly if it regresses:
 *
 * - a mistyped `?section=` must open the default, not blank the page;
 * - the Google Calendar callback must land on the section that renders its
 *   outcome banner, because the backend redirect cannot name a section;
 * - `sectionHref` and `parseSectionId` are two halves of the same contract, so
 *   a link that cannot be parsed back is a dead nav entry;
 * - every section needs its one-line description, or a card renders a bare
 *   title and the reader has to guess what the section is for.
 */

describe('parseSectionId', () => {
  it('accepts every known section', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(parseSectionId(section.id)).toBe(section.id);
    }
  });

  it('is case- and whitespace-insensitive, because these URLs get hand-typed', () => {
    expect(parseSectionId('Appearance')).toBe('appearance');
    expect(parseSectionId('  PRIVACY  ')).toBe('privacy');
  });

  it('treats an unknown value as absent rather than as an error', () => {
    // The alternative — throwing or 404ing — turns a mistyped shared link into
    // a broken settings page. The nav is still right there.
    expect(parseSectionId('security')).toBeNull();
    expect(parseSectionId('profile ; drop')).toBeNull();
  });

  it('treats missing and empty as absent', () => {
    expect(parseSectionId(null)).toBeNull();
    expect(parseSectionId(undefined)).toBeNull();
    expect(parseSectionId('')).toBeNull();
  });
});

describe('resolveSection', () => {
  it('opens the requested section', () => {
    expect(resolveSection({ section: 'notifications' })).toBe('notifications');
  });

  it('returns null when nothing was chosen, so the caller can show its index', () => {
    expect(resolveSection({})).toBeNull();
    expect(resolveSection({ section: null, calendar: null })).toBeNull();
  });

  it('sends a Google Calendar callback to the section that renders its banner', () => {
    // The backend redirects to a FIXED /account/settings?calendar=… — it has no
    // way to name a section, so this is the only place the outcome can be
    // routed to where the card that reports it actually renders.
    expect(resolveSection({ calendar: 'connected' })).toBe('account');
    expect(resolveSection({ calendar: 'error' })).toBe('account');
  });

  it('lets the callback outcome win over a section already in the URL', () => {
    expect(resolveSection({ section: 'appearance', calendar: 'connected' })).toBe('account');
  });
});

describe('contentSectionFor', () => {
  it('always answers with one section, so the content column is never blank', () => {
    expect(contentSectionFor({})).toBe(DEFAULT_SECTION_ID);
    // A mistyped or hand-edited value must open the default rather than leave a
    // rail beside an empty column — the one case where "treat it as absent"
    // would otherwise render nothing at all.
    expect(contentSectionFor({ section: 'security' })).toBe(DEFAULT_SECTION_ID);
    expect(contentSectionFor({ section: 'privacy' })).toBe('privacy');
    expect(contentSectionFor({ calendar: 'connected' })).toBe('account');
  });

  it('disagrees with resolveSection only when nothing was chosen', () => {
    // This pair IS the two-layouts-one-URL contract: `null` from
    // `resolveSection` is what makes the phone show the index, while
    // `contentSectionFor` is what the rail shows beside it at `lg`. If they ever
    // collapse into one function, one of the two layouts silently breaks — a
    // phone showing Profile with no way back to the other four, or a desktop
    // rail beside nothing.
    expect(resolveSection({})).toBeNull();
    expect(contentSectionFor({})).not.toBeNull();
    for (const section of SETTINGS_SECTIONS) {
      expect(contentSectionFor({ section: section.id })).toBe(
        resolveSection({ section: section.id }),
      );
    }
  });
});

describe('the section list', () => {
  it('round-trips every href back to its own section', () => {
    for (const section of SETTINGS_SECTIONS) {
      const query = sectionHref(section.id).split('?')[1] ?? '';
      const value = new URLSearchParams(query).get('section');
      expect(parseSectionId(value)).toBe(section.id);
    }
  });

  it('has unique ids and a description on every entry', () => {
    const ids = SETTINGS_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of SETTINGS_SECTIONS) {
      expect(section.label.length).toBeGreaterThan(0);
      expect(section.description.length).toBeGreaterThan(0);
    }
  });

  it('has a default that is one of them, and findSection is total', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toContain(DEFAULT_SECTION_ID);
    for (const section of SETTINGS_SECTIONS) {
      expect(findSection(section.id)).toBe(section);
    }
  });
});
