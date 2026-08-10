import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { POPULAR_CITIES } from '@/lib/discovery/cities';
import { CityScene, SceneCityDefault, cityScene } from './city-scenes';

/**
 * The set's standing obligations, plus the two specific to city artwork.
 *
 * The whole reason these exist is that ten tiles showed the SAME picture, and
 * ten identical pictures in a ten-tile grid is a bullet rather than artwork.
 * So "no two cities look alike" is not a nicety here — it is the feature, and
 * it is the first thing that would rot when somebody adds an eleventh city by
 * copying the tenth.
 */

const PAINT_ATTRS = ['fill', 'stroke', 'stop-color', 'color'];
const LEGAL_PAINT = /^(none|url\(#.+\)|rgb\(var\(--[a-z0-9-]+\)\))$/;

const SLUGS = POPULAR_CITIES.map((city) => city.slug);

describe.each(SLUGS)('%s', (slug) => {
  it('renders one svg and hides it from assistive technology', () => {
    const { container } = render(<CityScene slug={slug} />);
    const svgs = container.querySelectorAll('svg');

    expect(svgs).toHaveLength(1);
    expect(svgs[0]).toHaveAttribute('aria-hidden', 'true');
    expect(svgs[0]).toHaveAttribute('role', 'presentation');
  });

  it('paints only through design tokens', () => {
    const { container } = render(<CityScene slug={slug} />);

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

  it('gives every instance its own gradient ids', () => {
    // Ten of these render at once on the home page, and `<defs>` ids are
    // document-global — so a per-instance bug shows up as one city silently
    // adopting another's colours.
    const { container } = render(
      <div>
        <CityScene slug={slug} />
        <CityScene slug={slug} />
      </div>,
    );

    const ids = Array.from(container.querySelectorAll('[id]'), (node) => node.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never animates on its own', () => {
    // Ten on the home page. One drifting mark is charm; ten is a page that
    // will not sit still.
    const { container } = render(<CityScene slug={slug} />);
    expect(container.querySelectorAll('animate, animateTransform, animateMotion')).toHaveLength(0);
  });
});

describe('the set as a whole', () => {
  it('draws every curated city', () => {
    // `POPULAR_CITIES` is what the home page renders and what the sitemap
    // ships. A city with no scene would fall back silently to the skyline —
    // and "silently" is the problem: this is the test that fails when somebody
    // adds an eleventh city.
    for (const slug of SLUGS) {
      expect(cityScene(slug)).not.toBe(SceneCityDefault);
    }
  });

  it('gives no two cities the same picture', () => {
    // THE point of the set. Compared on the drawn geometry, with the shared
    // shell (defs, ground band) removed — so a scene that differs only by its
    // gradient ids still counts as a duplicate.
    const shapes = SLUGS.map((slug) => {
      const { container } = render(<CityScene slug={slug} />);
      const svg = container.querySelector('svg')!;
      svg.querySelector('defs')?.remove();
      return svg.innerHTML;
    });

    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it('falls back to a real skyline for a city with no landmark drawn', () => {
    // Every city with an event in it gets a tile, a landing page and a chip —
    // `POPULAR_CITIES` is only the curated ten. The fallback has to be a
    // picture rather than a hole.
    expect(cityScene('kochi')).toBe(SceneCityDefault);
    expect(cityScene(undefined)).toBe(SceneCityDefault);
  });

  it('matches a slug whatever its case', () => {
    expect(cityScene('MUMBAI')).toBe(cityScene('mumbai'));
  });
});
