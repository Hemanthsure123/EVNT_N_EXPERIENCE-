import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IdentityAvatar } from './avatar';

/**
 * The fallback is the whole contract of this component: a picture when there is
 * one, initials when there is not — and initials again when a picture that was
 * promised does not load.
 *
 * The last case is the one worth a test. `avatar_url` points at an object in
 * storage that can be deleted, or at a host that is not on `next.config.mjs`'s
 * `remotePatterns`, and both fail at the browser rather than at the API. Without
 * the `onError` fallback the header shows a broken-image glyph where a person's
 * face should be, on every page.
 *
 * Queried through `container` rather than `getByRole`: the medallion is
 * `aria-hidden` on purpose (every surface already names the person next to it),
 * so it has no accessible role to find it by — which is itself the intended
 * behaviour.
 */
describe('IdentityAvatar', () => {
  it('renders initials when there is no picture', () => {
    const { container } = render(<IdentityAvatar name="Asha Bhatt" />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('AB');
  });

  it('treats an empty avatar_url as no picture — that is what the column stores', () => {
    // `User.avatar_url` is `''`, never null, for "no picture set".
    const { container } = render(<IdentityAvatar name="Asha Bhatt" imageUrl="" />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('AB');
  });

  it('derives initials from an email when there is no name', () => {
    const { container } = render(<IdentityAvatar name="asha.bhatt@example.com" />);

    expect(container.textContent).toBe('AB');
  });

  it("falls back to '?' rather than rendering an empty circle", () => {
    const { container } = render(<IdentityAvatar name="" />);

    expect(container.textContent).toBe('?');
  });

  it('renders the picture, and no initials behind it, when there is one', () => {
    const { container } = render(
      <IdentityAvatar name="Asha Bhatt" imageUrl="https://cdn.example.com/a.png" />,
    );

    expect(container.querySelector('img')).not.toBeNull();
    // Decorative: the surrounding surface names the person, so an alt text here
    // would make a screen reader read the same name twice.
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
    expect(container.textContent).toBe('');
  });

  it('falls back to initials when the picture fails to load', () => {
    const { container } = render(
      <IdentityAvatar name="Asha Bhatt" imageUrl="https://cdn.example.com/deleted.png" />,
    );

    fireEvent.error(container.querySelector('img') as HTMLImageElement);

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('AB');
  });

  it('gives a NEW url a fresh attempt after a failed one', () => {
    // Without this, one broken image sticks the fallback on for the life of the
    // component — so the picture somebody just uploaded to REPLACE it would
    // never appear, on the surface they are watching to confirm the upload.
    const { container, rerender } = render(
      <IdentityAvatar name="Asha Bhatt" imageUrl="https://cdn.example.com/deleted.png" />,
    );
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();

    rerender(<IdentityAvatar name="Asha Bhatt" imageUrl="https://cdn.example.com/fresh.png" />);

    expect(container.querySelector('img')).not.toBeNull();
  });

  it('keeps showing initials for an organisation with no logo, as a tile', () => {
    // Shape carries person-vs-organisation, so the fallback has to keep it —
    // a circle of initials where a tile belongs reads as the wrong scope.
    const { container } = render(<IdentityAvatar name="Acme Events" shape="tile" />);
    const medallion = container.firstElementChild as HTMLElement;

    expect(medallion.className).toContain('rounded-lg');
    expect(medallion.className).not.toContain('rounded-full');
    expect(container.textContent).toBe('AE');
  });
});
