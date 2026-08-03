import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  SceneAllClear,
  SceneError,
  SceneNoResults,
  SceneNotFound,
  SceneNothingYet,
  SceneOffline,
} from './scenes';
import { SpotCity, SpotHireABand, SpotMood, SpotSubscribe, SpotTicket } from './spots';

/**
 * The four obligations of a drawn illustration set, none of which is visible in
 * a screenshot and every one of which has already been the bug somewhere:
 *
 *  1. IDS ARE UNIQUE PER INSTANCE. SVG `<defs>` ids are DOCUMENT-global. Two
 *     spots side by side with hard-coded ids means the second silently adopts
 *     the first one's gradient — the trap clay.tsx, brand-mark.tsx and
 *     sign-in-art.tsx each document, which is why every one of these is built
 *     on `useId`.
 *  2. EVERY COLOUR RESOLVES THROUGH A TOKEN. This is what makes both themes
 *     correct and what makes the whole set reskin with the brand. The lint rule
 *     only catches a hex literal; a named CSS colour (`white`, `black`,
 *     `currentColor` where a token was meant) walks straight past it and is
 *     wrong in exactly one of the two themes, which is the half nobody
 *     screenshots.
 *  3. ANIMATION IS OFF UNDER REDUCED MOTION, declared at the element rather
 *     than inherited from a global rule.
 *  4. THEY ARE DECORATIVE. A scene sits beside a heading that already says what
 *     happened; announcing it puts a paragraph of alt text between a screen
 *     reader user and the button that fixes their problem.
 */

const SCENES = {
  SceneNoResults,
  SceneNothingYet,
  SceneAllClear,
  SceneOffline,
  SceneError,
  SceneNotFound,
};

const SPOTS = { SpotHireABand, SpotCity, SpotSubscribe, SpotTicket, SpotMood };

const ALL = { ...SCENES, ...SPOTS };

/** Everything that can carry a colour in this set. */
const PAINT_ATTRS = ['fill', 'stroke', 'stop-color', 'color'];

/** A paint value is legal if it is a token, a reference to one of our own
 *  gradients, or an explicit absence. Nothing else. */
const LEGAL_PAINT = /^(none|url\(#.+\)|rgb\(var\(--[a-z0-9-]+\)\))$/;

describe.each(Object.entries(ALL))('%s', (_name, Illustration) => {
  it('renders one svg and hides it from assistive technology', () => {
    const { container } = render(<Illustration />);
    const svgs = container.querySelectorAll('svg');

    expect(svgs).toHaveLength(1);
    expect(svgs[0]).toHaveAttribute('aria-hidden', 'true');
    // `role="presentation"` as well as aria-hidden: Safari + VoiceOver has
    // historically announced an <svg> with no role regardless.
    expect(svgs[0]).toHaveAttribute('role', 'presentation');
  });

  it('paints only through design tokens', () => {
    const { container } = render(<Illustration />);

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
    // Two of the SAME illustration on one page is the case that breaks: the
    // ids differ between components by name anyway, so a per-instance bug only
    // shows up when the same one is rendered twice.
    const { container } = render(
      <div>
        <Illustration />
        <Illustration />
      </div>,
    );

    const ids = Array.from(container.querySelectorAll('[id]'), (node) => node.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('turns any animation off under prefers-reduced-motion', () => {
    const { container } = render(<Illustration />);

    container.querySelectorAll('[class]').forEach((node) => {
      const className = node.getAttribute('class') ?? '';
      if (/\billo-(float|sway|pulse)\b/.test(className)) {
        expect(className).toContain('motion-reduce:animate-none');
      }
    });
  });
});

describe('the set as a whole', () => {
  it('animates at most one element per illustration', () => {
    // The rule the comments state, enforced. An empty state or an error page is
    // read by somebody already stuck: one slow move reads as "the page is
    // alive", three read as a cartoon and pull the eye off the sentence that
    // says what to do.
    Object.entries(ALL).forEach(([name, Illustration]) => {
      const { container, unmount } = render(<Illustration />);
      const animated = container.querySelectorAll('.illo-float, .illo-sway, .illo-pulse');
      expect(animated.length, `${name} animates ${animated.length} elements`).toBeLessThanOrEqual(
        1,
      );
      unmount();
    });
  });

  it('leaves the three original empty-state scenes completely still', () => {
    // A list that is merely empty is not a situation that needs the page to
    // prove it is still running.
    (
      [
        ['SceneNoResults', SceneNoResults],
        ['SceneNothingYet', SceneNothingYet],
        ['SceneAllClear', SceneAllClear],
      ] as const
    ).forEach(([name, Scene]) => {
      const { container, unmount } = render(<Scene />);
      expect(
        container.querySelectorAll('.illo-float, .illo-sway, .illo-pulse'),
        `${name} should not animate`,
      ).toHaveLength(0);
      unmount();
    });
  });
});
