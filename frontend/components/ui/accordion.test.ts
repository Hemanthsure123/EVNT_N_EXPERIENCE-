import { describe, expect, it } from 'vitest';
import { toggleAccordionValue } from './accordion';

/**
 * The reducer only — it is the whole of the accordion's real logic, and the
 * `single` / `collapsible` interaction is where a hand-rolled disclosure group
 * gets it wrong (usually by letting two panels be open at once after a fast
 * double press).
 */
describe('toggleAccordionValue', () => {
  const single = { type: 'single' as const, collapsible: true };
  const pinned = { type: 'single' as const, collapsible: false };
  const multiple = { type: 'multiple' as const, collapsible: true };

  it('opens a closed panel', () => {
    expect(toggleAccordionValue([], 'a', single)).toEqual(['a']);
  });

  it('closes whatever else was open in single mode', () => {
    expect(toggleAccordionValue(['a'], 'b', single)).toEqual(['b']);
  });

  it('closes the open panel when collapsible', () => {
    expect(toggleAccordionValue(['a'], 'a', single)).toEqual([]);
  });

  it('keeps the open panel open when not collapsible', () => {
    expect(toggleAccordionValue(['a'], 'a', pinned)).toEqual(['a']);
  });

  it('still switches panels when not collapsible', () => {
    expect(toggleAccordionValue(['a'], 'b', pinned)).toEqual(['b']);
  });

  it('accumulates in multiple mode', () => {
    expect(toggleAccordionValue(['a'], 'b', multiple)).toEqual(['a', 'b']);
  });

  it('removes only the pressed panel in multiple mode', () => {
    expect(toggleAccordionValue(['a', 'b', 'c'], 'b', multiple)).toEqual(['a', 'c']);
  });

  it('never mutates the array it was given', () => {
    const open = ['a'];
    toggleAccordionValue(open, 'b', multiple);
    toggleAccordionValue(open, 'a', single);
    expect(open).toEqual(['a']);
  });

  it('returns a new array even for a no-op, so a controlled caller sees one shape', () => {
    const open = ['a'];
    const next = toggleAccordionValue(open, 'a', pinned);
    expect(next).toEqual(['a']);
    expect(next).not.toBe(open);
  });
});
