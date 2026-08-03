import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { RollingHint, __resetRollClock, useRollingTerm } from './rolling-placeholder';

const TERMS = ['Comedy this weekend', 'Concerts in Mumbai', 'Free events near you'];

function Harness({ enabled = true }: { enabled?: boolean }) {
  const { index, item } = useRollingTerm(TERMS, enabled);
  return (
    <div>
      <span data-testid="showing">{item}</span>
      <RollingHint terms={TERMS} index={index} />
    </div>
  );
}

/** The class the ONE visible term carries. */
const shown = (term: string) =>
  screen.getAllByText(term).find((node) => node.className.includes('opacity-100'));

describe('the rolling search hint', () => {
  beforeEach(() => {
    __resetRollClock();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetRollClock();
  });

  it('paints the first term before any tick, so hydration matches', () => {
    // The clock is started by an effect. If the first client render could land
    // on any other term, the server HTML and the client tree would differ and
    // React would throw the whole subtree away.
    render(<Harness />);
    expect(screen.getByTestId('showing')).toHaveTextContent(TERMS[0]);
    expect(shown(TERMS[0])).toBeTruthy();
  });

  it('rolls the current term up and out while the next rolls up into place', () => {
    render(<Harness />);
    act(() => vi.advanceTimersByTime(4000));

    expect(screen.getByTestId('showing')).toHaveTextContent(TERMS[1]);
    // Up and OUT, not down: the term that just left sits a line ABOVE.
    expect(screen.getAllByText(TERMS[0])[0]?.className).toContain('-translate-y-full');
    expect(shown(TERMS[1])).toBeTruthy();
    // Everything not adjacent waits BELOW, ready to roll up in turn.
    expect(screen.getAllByText(TERMS[2])[0]?.className).toContain('translate-y-full');
  });

  it('freezes rather than resets when disabled', () => {
    // The palette takes focus the moment it opens, which disables the roll —
    // and it must keep showing the term the user pressed, not jump back to the
    // first one.
    const { rerender } = render(<Harness enabled />);
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByTestId('showing')).toHaveTextContent(TERMS[1]);

    rerender(<Harness enabled={false} />);
    act(() => vi.advanceTimersByTime(20000));
    expect(screen.getByTestId('showing')).toHaveTextContent(TERMS[1]);
  });

  it('never moves under prefers-reduced-motion', () => {
    const matchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      }),
    });

    try {
      render(<Harness />);
      act(() => vi.advanceTimersByTime(30000));
      // Static first term — not a slower roll. The requirement is no motion.
      expect(screen.getByTestId('showing')).toHaveTextContent(TERMS[0]);
    } finally {
      Object.defineProperty(window, 'matchMedia', { writable: true, value: matchMedia });
    }
  });

  it('is hidden from assistive tech, because the input owns the semantics', () => {
    render(<RollingHint terms={TERMS} index={0} />);
    // An accessible name that changes every few seconds cannot be read out or
    // acted on; the real `<input placeholder>`/`aria-label` stays stable.
    expect(screen.getAllByText(TERMS[0])[0]?.closest('[aria-hidden="true"]')).toBeTruthy();
  });

  it('renders the fallback, unanimated, when there is nothing to roll', () => {
    render(<RollingHint terms={[]} index={0} fallback="Search events" />);
    expect(screen.getByText('Search events')).toBeTruthy();
  });
});
