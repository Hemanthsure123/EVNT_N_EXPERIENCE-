import { describe, expect, it } from 'vitest';
import { ORGANIZER_SECTIONS } from './nav';
import { STEPS } from './wizard/model';

const WORDS = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five',
  'Six', 'Seven', 'Eight', 'Nine', 'Ten',
];

describe('organizer nav', () => {
  it('promises the number of wizard steps there actually are', () => {
    // The hint read "Six steps" against an eight-step wizard — the count from
    // before Search and Details were added. It shows in the sidebar AND in the
    // ⌘K palette, so both promised a shorter job than the form is.
    const create = ORGANIZER_SECTIONS.find((s) => s.href === '/dashboard/events/new');
    expect(create).toBeDefined();
    expect(create?.hint).toBe(`${WORDS[STEPS.length]} steps, saved as you type`);
  });

  it('has no duplicate destinations', () => {
    const hrefs = ORGANIZER_SECTIONS.map((s) => s.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
