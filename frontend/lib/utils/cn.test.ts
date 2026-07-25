import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('merges conflicting Tailwind classes (last wins)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('resolves the custom design-token font-size group', () => {
    expect(cn('text-body', 'text-h1')).toBe('text-h1');
  });

  it('resolves the custom shadow group', () => {
    expect(cn('shadow-md', 'shadow-glow')).toBe('shadow-glow');
  });

  it('drops falsy values and keeps non-conflicting classes', () => {
    expect(cn('rounded-xl', false, undefined, 'bg-primary')).toBe('rounded-xl bg-primary');
  });
});
