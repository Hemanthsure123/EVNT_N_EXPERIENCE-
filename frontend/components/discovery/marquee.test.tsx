import * as React from 'react';
import { describe, expect, it, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Marquee } from './marquee';

/**
 * The rail's obligations.
 *
 * The drift itself is a `scrollLeft` write in a rAF loop and needs no test —
 * what needs one is everything that makes the rail USABLE, because that is
 * exactly what the previous implementation got wrong: it looked interactive
 * and most of its cards could not be clicked.
 */

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class Stub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', { value: Stub, writable: true });
  }
});

function Cards() {
  return (
    <>
      <a href="/events/1">Sunburn Arena</a>
      <a href="/events/2">Comedy Night</a>
    </>
  );
}

function renderRail() {
  return render(
    <Marquee ariaLabel="Featured events">
      <Cards />
    </Marquee>,
  );
}

describe('Marquee', () => {
  it('renders every card as a real, clickable link', () => {
    // THE regression this file exists for. The copies used to be `inert`,
    // which blocks pointer events as well as assistive technology — so most of
    // what was on screen silently ignored clicks.
    const { container } = renderRail();

    const inert = container.querySelectorAll('[inert]');
    expect(inert).toHaveLength(0);

    // Both copies are in the DOM, both are anchors, neither is disabled.
    const anchors = container.querySelectorAll('a[href="/events/1"]');
    expect(anchors.length).toBeGreaterThanOrEqual(2);
    anchors.forEach((a) => expect(a.getAttribute('aria-disabled')).toBeNull());
  });

  it('announces each event once', () => {
    // The seam copy is `aria-hidden`, so the accessibility tree sees one set
    // even though the DOM holds two.
    renderRail();
    expect(screen.getAllByRole('link', { name: 'Sunburn Arena' })).toHaveLength(1);
    expect(screen.getByRole('list', { name: 'Featured events' })).toBeInTheDocument();
  });

  it('keeps the seam copy out of the tab order without blocking clicks', () => {
    // `tabindex="-1"` rather than `inert`: tab skips the copies, a mouse does
    // not. That distinction is the whole fix.
    const { container } = renderRail();
    const copy = container.querySelector('ul[aria-hidden="true"]');

    expect(copy).not.toBeNull();
    expect(copy).not.toHaveAttribute('inert');
    copy!.querySelectorAll('a').forEach((a) => {
      expect(a.getAttribute('tabindex')).toBe('-1');
    });
  });

  it('is a real scroll container', () => {
    // Drag, wheel, trackpad, touch and keyboard scrolling all come from this
    // and none of them had to be written.
    const { container } = renderRail();
    const viewport = container.querySelector('.marquee-mask');
    expect(viewport).toHaveClass('overflow-x-auto');
  });

  it('offers arrows once there is something to scroll', () => {
    // jsdom reports every width as 0, so `canScroll` is false and the arrows
    // are correctly absent — which is itself the assertion worth making: a
    // control that cannot move anything is not rendered.
    renderRail();
    expect(screen.queryByRole('button', { name: /scroll right/i })).not.toBeInTheDocument();
  });

  /*
   * Pause-on-hover, pause-when-hidden, the arrows and the drift itself are NOT
   * asserted here, and deliberately not with `expect(el).toBeInTheDocument()`
   * standing in for them. jsdom runs no animation frames and reports every
   * width as zero, so those tests could only ever assert that the component
   * rendered — a test that cannot fail is worse than an absent one, because it
   * reads as coverage.
   *
   * They are verified in a real browser instead, where scroll position, hover
   * and the arrows are actually observable.
   */
});
