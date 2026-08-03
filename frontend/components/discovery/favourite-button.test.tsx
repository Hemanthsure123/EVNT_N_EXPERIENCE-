import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FavouriteButton } from './favourite-button';
import { replaceSavedEventIds } from '@/lib/discovery/use-favourites';

/**
 * The two ways a save flourish goes wrong, both of which look fine in a single
 * manual click and are obvious the moment somebody scrolls a real page.
 */
describe('FavouriteButton', () => {
  beforeEach(() => {
    // The store holds a module-level cache, so clearing storage alone leaves
    // the previous test's set in memory.
    replaceSavedEventIds([]);
    window.localStorage.clear();
  });

  it('does not fire the beat on mount for an already-saved event', async () => {
    // Otherwise a browse page where six cards are saved pops all six at once
    // on load — a page-wide flicker nobody asked for.
    replaceSavedEventIds(['evt-1']);

    render(<FavouriteButton eventId="evt-1" title="Zakir Khan" />);

    const button = await screen.findByRole('button', { pressed: true });
    expect(button.querySelector('.animate-heart-pop')).toBeNull();
  });

  it('fires the beat when the press saves', async () => {
    render(<FavouriteButton eventId="evt-1" title="Zakir Khan" />);

    await userEvent.click(screen.getByRole('button'));

    const button = screen.getByRole('button', { pressed: true });
    expect(button.querySelector('.animate-heart-pop')).not.toBeNull();
  });

  it('does not animate the removal', async () => {
    // The flourish belongs to the affirmative action. Animating a removal
    // reads as a second confirmation of something already decided.
    render(<FavouriteButton eventId="evt-1" title="Zakir Khan" />);
    const button = screen.getByRole('button');

    await userEvent.click(button);
    await userEvent.click(button);

    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.querySelector('.animate-heart-pop')).toBeNull();
  });

  it('names the event in the label, in both states', async () => {
    render(<FavouriteButton eventId="evt-1" title="Zakir Khan" />);

    expect(screen.getByLabelText('Save Zakir Khan for later')).toBeTruthy();
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByLabelText('Remove Zakir Khan from saved')).toBeTruthy();
  });
});
