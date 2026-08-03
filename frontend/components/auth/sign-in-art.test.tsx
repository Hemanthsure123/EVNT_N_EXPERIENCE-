import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SignInArt } from './sign-in-art';

/**
 * The decoration's two obligations, both invisible in a screenshot.
 */
describe('SignInArt', () => {
  it('is hidden from assistive technology, in one piece', () => {
    const { container } = render(
      <div>
        <SignInArt />
        <button type="button">Sign in</button>
      </div>,
    );

    // A drawn ticket is not information — the form beside it already says what
    // this page is. Announcing it puts a paragraph between a screen-reader user
    // and the control they came for. The `aria-hidden` must be on the WRAPPER,
    // not just the <svg>, or the sheen element leaks through.
    expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
    expect(screen.getByRole('button')).toBeVisible();
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('carries its own keyframes and its own reduced-motion escape hatch', () => {
    const { container } = render(<SignInArt />);
    const css = container.querySelector('style')?.textContent ?? '';

    // The global rule in styles/globals.css would already neutralise this, but
    // "it happens to inherit the right behaviour" is not a guarantee — and the
    // sheen must vanish rather than freeze mid-sweep as a violet smear.
    expect(css).toContain('prefers-reduced-motion');

    // Transform and opacity ONLY inside the keyframes, so the sweep is
    // composited and never triggers layout or paint. `width` and `left` appear
    // in the static rule above it, which is why this reads the keyframe body
    // rather than the whole sheet.
    const frames = /@keyframes signin-sheen\{([\s\S]*?)\n\}/.exec(css)?.[1];
    expect(frames).toBeTruthy();
    const animated = new Set(Array.from(frames!.matchAll(/([a-z-]+)\s*:/g), (m) => m[1]));
    expect([...animated].sort()).toEqual(['opacity', 'transform']);
  });
});
