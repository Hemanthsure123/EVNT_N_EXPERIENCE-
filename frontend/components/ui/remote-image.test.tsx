import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RemoteImage } from './remote-image';

/**
 * This now backs every storage-adapter image in the product — event posters,
 * gallery tiles, performer photos, the studio's photo manager. A regression
 * here reintroduces the broken-image glyph on all of them at once.
 */
describe('RemoteImage', () => {
  it('renders the image when there is a url', () => {
    render(<RemoteImage src="https://cdn.example.com/a.jpg" alt="A poster" />);
    expect(screen.getByAltText('A poster')).toBeInTheDocument();
  });

  it('shows the fallback when there is no url', () => {
    render(<RemoteImage src={null} fallback={<span>No cover</span>} />);
    expect(screen.getByText('No cover')).toBeInTheDocument();
  });

  it('swaps to the fallback when the image fails', () => {
    // The whole point: a missing object must not paint the browser's torn-page
    // glyph inside a layout expecting a photograph.
    render(<RemoteImage src="https://cdn.example.com/gone.jpg" fallback={<span>Gone</span>} />);
    fireEvent.error(screen.getByRole('presentation', { hidden: true }));
    expect(screen.getByText('Gone')).toBeInTheDocument();
  });

  it('retries a DIFFERENT url after one failed', () => {
    // Tracked by url rather than as a boolean: a boolean latches for the life
    // of the component, so re-uploading a photo would keep showing the
    // placeholder and make a successful upload look like it failed too.
    const { rerender } = render(
      <RemoteImage src="https://cdn.example.com/gone.jpg" fallback={<span>Gone</span>} />,
    );
    fireEvent.error(screen.getByRole('presentation', { hidden: true }));
    expect(screen.getByText('Gone')).toBeInTheDocument();

    rerender(<RemoteImage src="https://cdn.example.com/fresh.jpg" fallback={<span>Gone</span>} />);
    expect(screen.queryByText('Gone')).not.toBeInTheDocument();
  });

  it('defaults alt to empty, so a decorative photo is not announced twice', () => {
    const { container } = render(<RemoteImage src="https://cdn.example.com/a.jpg" />);
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
  });
});
