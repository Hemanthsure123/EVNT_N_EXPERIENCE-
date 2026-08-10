import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  SceneAboutYou,
  SceneOnboardingDone,
  SceneWelcome,
  SceneYourName,
  SceneYourPhoto,
} from './onboarding-scenes';

/**
 * The set's four standing obligations, plus the one that is specific to these.
 *
 * ── THESE ARE THE ONLY SCENES ALLOWED TO ANIMATE ──────────────────────────
 *
 * The category and performer sets are deliberately still: eight or nine render
 * at once on a browse grid. Here exactly one is on screen at a time and it is
 * the largest thing on it, so ambience is doing work rather than competing.
 *
 * The rule that keeps that honest is CSS, never SMIL. `prefers-reduced-motion`
 * cannot reach an `<animate>` element, so an SVG animating that way keeps
 * moving for somebody who asked the whole system to stop — and would do it
 * inside a modal they cannot dismiss without reading it.
 */

const SCENES = {
  SceneWelcome,
  SceneYourName,
  SceneYourPhoto,
  SceneAboutYou,
  SceneOnboardingDone,
};

const PAINT_ATTRS = ['fill', 'stroke', 'stop-color', 'color'];
const LEGAL_PAINT = /^(none|url\(#.+\)|rgb\(var\(--[a-z0-9-]+\)\))$/;

describe.each(Object.entries(SCENES))('%s', (_name, Scene) => {
  it('renders one svg and hides it from assistive technology', () => {
    const { container } = render(<Scene />);
    const svgs = container.querySelectorAll('svg');

    expect(svgs).toHaveLength(1);
    expect(svgs[0]).toHaveAttribute('aria-hidden', 'true');
    expect(svgs[0]).toHaveAttribute('role', 'presentation');
  });

  it('paints only through design tokens', () => {
    const { container } = render(<Scene />);

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
    const { container } = render(
      <div>
        <Scene />
        <Scene />
      </div>,
    );

    const ids = Array.from(container.querySelectorAll('[id]'), (node) => node.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('animates through CSS, never SMIL', () => {
    // The load-bearing rule. `prefers-reduced-motion` is a media query, and a
    // media query cannot switch off an `<animate>` element — so a scene that
    // used SMIL would keep moving for somebody who asked everything to stop.
    const { container } = render(<Scene />);
    expect(container.querySelectorAll('animate, animateTransform, animateMotion')).toHaveLength(0);
    expect(container.querySelectorAll('[class*="illo-a-"]').length).toBeGreaterThan(0);
  });

  it('is 4:3 at the larger onboarding size', () => {
    // 200×150 rather than the sets' 160×120: these are the hero of a dialog at
    // 200-260px, where the extra room buys detail that would be mud at tile
    // size.
    const { container } = render(<Scene />);
    expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 200 150');
  });
});

describe('the set as a whole', () => {
  it('gives every step its own picture', () => {
    // Five steps, five scenes. Two steps showing the same drawing is a flow
    // that looks like it did not advance.
    const shapes = Object.values(SCENES).map((Scene) => {
      const { container } = render(<Scene />);
      const svg = container.querySelector('svg')!;
      svg.querySelector('defs')?.remove();
      return svg.innerHTML;
    });

    expect(new Set(shapes).size).toBe(shapes.length);
  });
});
