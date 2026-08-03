import * as React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PERFORMER_TYPE_LABELS, type PerformerType } from '@/lib/api/performers';
import { PerformerArt, PerformerFrame, performerPlate } from './performer-art';

const TYPES = Object.keys(PERFORMER_TYPE_LABELS) as PerformerType[];

/**
 * The bug this file exists to stop coming back: an act with no photograph
 * rendered a grey rectangle, which reads as a broken image rather than as a
 * listing without a picture.
 *
 * Two guarantees, and both fail silently in a browser rather than throwing —
 * which is exactly why they are asserted here. A performer type added to the
 * API without a plate falls back to a neutral, and one added without a glyph
 * would otherwise render an EMPTY tile: a coloured box, i.e. the original bug
 * wearing a nicer colour.
 */
describe('performer artwork', () => {
  it('draws an object for every performer type the API can return', () => {
    for (const type of TYPES) {
      const { container, unmount } = render(<PerformerArt type={type} />);
      const svg = container.querySelector('svg');

      expect(svg, `${type} renders no artwork`).not.toBeNull();
      // The tile body plus the occlusion pool is 3 rects on its own — a glyph
      // means something is drawn INSIDE the `<g>` that carries the ink.
      const glyph = svg?.querySelector('g');
      expect(glyph?.childElementCount ?? 0, `${type} has an empty tile`).toBeGreaterThan(0);

      unmount();
    }
  });

  it('gives every performer type a plate, and an unknown one a neutral', () => {
    for (const type of TYPES) {
      expect(performerPlate(type), `${type} has no plate`).toMatch(/^bg-/);
    }
    // A type this frontend has never heard of must still be a real surface.
    expect(performerPlate('theremin_soloist')).toBe(performerPlate('other'));
  });

  it('is decorative — the act name beside it is the accessible name', () => {
    const { container } = render(<PerformerArt type="band" />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders the photo when there is one, and the artwork when there is not', () => {
    const withPhoto = render(
      <PerformerFrame type="dj" photoUrl="https://example.test/a.jpg" photoAlt="Live at Antisocial" />,
    );
    expect(withPhoto.container.querySelector('img')?.getAttribute('alt')).toBe(
      'Live at Antisocial',
    );
    expect(withPhoto.container.querySelector('svg')).toBeNull();
    withPhoto.unmount();

    const without = render(<PerformerFrame type="dj" photoUrl="" />);
    expect(without.container.querySelector('img')).toBeNull();
    expect(without.container.querySelector('svg')).not.toBeNull();
  });

  it('gives each instance its own gradient ids', () => {
    // SVG `<defs>` ids are DOCUMENT-global and twenty cards render at once —
    // shared ids mean every tile after the first silently adopts the first
    // one's colours.
    const { container } = render(
      <>
        <PerformerArt type="band" />
        <PerformerArt type="magician" />
      </>,
    );
    const ids = Array.from(container.querySelectorAll('linearGradient')).map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
