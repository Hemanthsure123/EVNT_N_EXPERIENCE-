import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Reveal } from './reveal';

/**
 * These do not test the fade. They test that the fade can never SWALLOW the
 * content, which is a different thing and the only part worth a test: this
 * wraps every card in the event grid, so a reveal that fails to fire is a
 * blank catalogue on a page that returned 200.
 *
 * `data-revealed` absent means the CSS leaves the element visible. Every case
 * below asserts it is absent, which is the same assertion as "the visitor can
 * see the events" without depending on jsdom computing opacity.
 */

function stubMatchMedia(reduced: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: reduced,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  );
}

function stubObserver() {
  const observe = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = observe;
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  return observe;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Reveal', () => {
  it('never hides content when the browser has no IntersectionObserver', () => {
    stubMatchMedia(false);
    vi.stubGlobal('IntersectionObserver', undefined);

    render(
      <Reveal>
        <p>Trending this week</p>
      </Reveal>,
    );

    expect(screen.getByText('Trending this week').parentElement).not.toHaveAttribute(
      'data-revealed',
    );
  });

  it('does nothing at all when the visitor asked for reduced motion', () => {
    stubMatchMedia(true);
    const observe = stubObserver();

    render(
      <Reveal>
        <p>Comedy near you</p>
      </Reveal>,
    );

    // Not "animates instantly" — no observer is attached and no hidden state
    // is ever written.
    expect(observe).not.toHaveBeenCalled();
    expect(screen.getByText('Comedy near you').parentElement).not.toHaveAttribute('data-revealed');
  });

  it('leaves content already on screen alone rather than flashing it', () => {
    stubMatchMedia(false);
    const observe = stubObserver();

    // jsdom reports a zero box at the origin, which is above the fold.
    render(
      <Reveal>
        <p>Above the fold</p>
      </Reveal>,
    );

    expect(observe).not.toHaveBeenCalled();
    expect(screen.getByText('Above the fold').parentElement).not.toHaveAttribute('data-revealed');
  });
});
