import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GalleryGrid } from './gallery-grid';

/**
 * A gallery that holds a trailer as well as photographs.
 *
 * The organiser's video used to have nowhere to appear at all: the grid took
 * `kind === 'gallery'` and the hero took the poster, so a `MediaKind.VIDEO`
 * row — which the backend has supported from the start, through
 * `core.video_embeds` and its host allow-list — was attached and then
 * invisible.
 *
 * Two properties are worth pinning, and neither is about how it looks.
 */

// A plain `<img>` stands in for `next/image`, which needs a loader and a
// configured host that jsdom has neither of. The lint rule about `<img>` is
// about LCP on a real page; this one never ships.
// eslint-disable-next-line @next/next/no-img-element
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

const PHOTO = { url: 'https://cdn.test/a.jpg', alt: 'The crowd' };
const VIDEO = {
  kind: 'video' as const,
  url: 'https://www.youtube-nocookie.com/embed/abc123',
  alt: 'Curatix trailer',
};

describe('GalleryGrid', () => {
  it('draws a video tile as a still with a play control, never an iframe', () => {
    render(<GalleryGrid images={[VIDEO, PHOTO]} />);

    // Six embedded players in a scroller is six third-party documents loading
    // their own scripts on the busiest public route — and each one swallows
    // the tap that was meant to open the viewer. The player exists only
    // full-screen.
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('button', { name: /play/i })).toBeTruthy();
  });

  it('says PLAY for a video and VIEW for a photograph', () => {
    render(<GalleryGrid images={[VIDEO, PHOTO]} />);
    // The accessible name is the only thing distinguishing the two for a
    // screen-reader user; the play badge is `aria-hidden` scenery.
    expect(screen.getByRole('button', { name: 'Play Curatix trailer' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'The crowd' })).toBeTruthy();
  });

  it('opens the full-screen player on the tile that was pressed', () => {
    render(<GalleryGrid images={[VIDEO, PHOTO]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Play Curatix trailer' }));

    const frame = document.querySelector('iframe');
    expect(frame).not.toBeNull();
    // Autoplay, because somebody who pressed a play badge has already said
    // what they want. A second press inside the player is a step that exists
    // only because the embed defaults that way.
    expect(frame?.getAttribute('src')).toContain('autoplay=1');
  });

  it('renders nothing at all when there is no media', () => {
    // Absent, not empty. A heading over an empty grid reads as photographs
    // that failed to load.
    const { container } = render(<GalleryGrid images={[]} />);
    expect(container.innerHTML).toBe('');
  });
});
