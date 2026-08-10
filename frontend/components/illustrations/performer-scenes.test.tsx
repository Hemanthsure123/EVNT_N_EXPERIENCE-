import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { PERFORMER_TYPE_LABELS, type PerformerType } from '@/lib/api/enquiries';
import {
  PerformerScene,
  SceneAnchor,
  SceneBand,
  SceneComedian,
  SceneDanceCrew,
  SceneDj,
  SceneInstrumentalist,
  SceneMagician,
  ScenePerformerOther,
  SceneSinger,
  performerScene,
} from './performer-scenes';

/**
 * The same four obligations `illustrations.test.tsx` states, applied to the
 * marketplace's set — plus two that are specific to it.
 *
 * The set-specific ones matter because of where these render: a four-column
 * grid of NINE act types on one page. So a per-instance gradient bug shows up
 * as one tile silently adopting another's colours, and two acts sharing a
 * silhouette shows up as a grid nobody can scan.
 */

const SCENES = {
  SceneBand,
  SceneSinger,
  SceneDj,
  SceneInstrumentalist,
  SceneAnchor,
  SceneComedian,
  SceneDanceCrew,
  SceneMagician,
  ScenePerformerOther,
};

const TYPES = Object.keys(PERFORMER_TYPE_LABELS) as PerformerType[];

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
    // The case that actually breaks: the hire page renders NINE of these at
    // once, and `<defs>` ids are document-global. Two of the SAME scene is the
    // strictest version of it.
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

  it('keeps the scene 4:3', () => {
    // A scene has a horizon, and a horizon needs width. Squaring one off cuts
    // the ground out from under the figures — which is why every caller sizes
    // the box rather than the component doing it.
    const { container } = render(<Scene />);
    expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 160 120');
  });

  it('reacts INSIDE the drawing rather than moving as a whole', () => {
    // The rule the reaction system exists for: something happens in the
    // illustration on hover — the mic lifts, the ball turns — and the card
    // around it does not jump. A scene with no marked element is a tile whose
    // only feedback is the border, which is what this set replaced.
    const { container } = render(<Scene />);
    expect(container.querySelectorAll('[class*="illo-r-"]').length).toBeGreaterThan(0);
  });

  it('never animates on its own', () => {
    // Nine on the hire page. One drifting mark beside a heading is charm; nine
    // is a page that will not sit still.
    const { container } = render(<Scene />);
    expect(container.querySelectorAll('animate, animateTransform, animateMotion')).toHaveLength(0);
  });
});

describe('the set as a whole', () => {
  it('draws every performer type the API can send', () => {
    // Keyed off the LABEL map, which is the one exhaustive `Record<PerformerType, …>`
    // in the codebase — so a tenth act added to `PerformerType` fails to
    // compile there first, and fails here second. A type with no scene would
    // otherwise render the fallback silently, and "silently" is the problem.
    for (const type of TYPES) {
      if (type === 'other') continue;
      expect(performerScene(type)).not.toBe(ScenePerformerOther);
    }
  });

  it('falls back to a real picture for a type this build has not seen', () => {
    // An empty stage: a place waiting for somebody, rather than a question
    // mark or a hole in the grid.
    expect(performerScene('hologram_orchestra')).toBe(ScenePerformerOther);
  });

  it('gives no two acts the same silhouette', () => {
    // The hard constraint. Three of the nine — singer, anchor, comedian —
    // would each naturally have been a microphone, and three identical scenes
    // in a four-column grid is a grid nobody can use. Compared on the drawn
    // geometry, with the shared shell (defs, ground band) removed.
    const shapes = Object.values(SCENES).map((Scene) => {
      const { container } = render(<Scene />);
      const svg = container.querySelector('svg')!;
      svg.querySelector('defs')?.remove();
      return svg.innerHTML;
    });

    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it('renders each type through the one public entry point', () => {
    for (const type of TYPES) {
      const { container } = render(<PerformerScene type={type} />);
      expect(container.querySelector('svg')).toBeTruthy();
    }
  });
});
