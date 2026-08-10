import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { EventPosterArt } from './poster';

/**
 * Poster art is the most-repeated illustration in the product — twenty of them
 * on a browse page — so its failure modes are the ones that scale.
 */

const SLUGS = ['concerts', 'comedy', 'workshops', 'sports', 'festivals', 'nightlife'];

/** The same rule the rest of the set is held to. */
const LEGAL_PAINT = /^(none|url\(#.+\)|rgb\(var\(--[a-z0-9-]+\)\))$/;
const PAINT_ATTRS = ['fill', 'stroke', 'stop-color', 'color'];

describe('EventPosterArt', () => {
  it.each(SLUGS)('paints %s only through design tokens', (slug) => {
    const { container } = render(<EventPosterArt slug={slug} seed="abc" />);

    const illegal: string[] = [];
    container.querySelectorAll('*').forEach((node) => {
      PAINT_ATTRS.forEach((attr) => {
        const value = node.getAttribute(attr);
        if (value !== null && !LEGAL_PAINT.test(value)) {
          illegal.push(`${node.nodeName}[${attr}="${value}"]`);
        }
      });
    });

    expect(illegal).toEqual([]);
  });

  it('is decorative — a card already carries the event title', () => {
    const { container } = render(<EventPosterArt slug="concerts" seed="a" />);
    container.querySelectorAll('svg').forEach((svg) => {
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    });
  });

  it('gives every instance its own gradient ids', () => {
    /**
     * THE test for this component. `<defs>` ids are DOCUMENT-global and a
     * browse page renders twenty of these — hard-coded ids would mean nineteen
     * cards silently adopting the first one's gradients, which looks like a
     * colour bug rather than an id bug.
     */
    const { container } = render(
      <div>
        <EventPosterArt slug="concerts" seed="one" />
        <EventPosterArt slug="comedy" seed="two" />
        <EventPosterArt slug="concerts" seed="three" />
      </div>,
    );

    const ids = Array.from(container.querySelectorAll('[id]'), (node) => node.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never animates', () => {
    // One drifting mark beside a heading is charm; twenty in a grid is a page
    // that will not sit still.
    const { container } = render(<EventPosterArt slug="festivals" seed="x" />);
    expect(container.querySelectorAll('.illo-float, .illo-sway, .illo-pulse')).toHaveLength(0);
  });

  it('is DETERMINISTIC for a given seed', () => {
    /**
     * It renders on the server and again in the browser. A `Math.random()`
     * layout would differ between the two — a hydration mismatch, which React
     * resolves by discarding the server HTML and re-rendering, on the single
     * most numerous component on the page.
     */
    const first = render(<EventPosterArt slug="concerts" seed="event-42" />);
    const firstShape = first.container.querySelector('circle')?.getAttribute('cy');
    first.unmount();

    const second = render(<EventPosterArt slug="concerts" seed="event-42" />);
    const secondShape = second.container.querySelector('circle')?.getAttribute('cy');

    expect(firstShape).toBe(secondShape);
  });

  it('VARIES across seeds, so a grid does not read as one repeated tile', () => {
    const shapeFor = (seed: string) => {
      const { container, unmount } = render(<EventPosterArt slug="concerts" seed={seed} />);
      // The arc's centre moves per layout; enough to prove the composition
      // changed rather than only the colour.
      const value = container.querySelector('circle')?.getAttribute('cy');
      unmount();
      return value;
    };

    const shapes = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(shapeFor).filter(Boolean));
    expect(shapes.size).toBeGreaterThan(1);
  });

  it('renders without a category rather than crashing', () => {
    // `inferCategory` returns nothing when an event's wording matches none of
    // the eight, which is common and must not break the card.
    const { container } = render(<EventPosterArt slug="" seed="no-category" />);
    expect(container.querySelector('svg')).toBeTruthy();
  });
});
