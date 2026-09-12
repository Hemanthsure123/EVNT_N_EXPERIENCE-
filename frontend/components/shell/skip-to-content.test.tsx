import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * The three defects behind "a black Skip to content button is permanently
 * visible, overlapping the top-left of the UI" on the event page.
 *
 * Measured on the deployed site before the fix: one Tab put the link at
 * `fixed` 16,16 at 138×36, and the brand lockup sits at 16,14 at 62×36 — it
 * covered the logo exactly, which is what the report's screenshot showed.
 *
 * The visual half (`:focus` -> `:focus-visible`) is CSS and belongs in the
 * e2e/visual pass; jsdom has no layout engine and no `:focus-visible`
 * heuristic. What is worth pinning here is the behaviour underneath it, which
 * a screenshot would never catch.
 */

const deck = vi.hoisted(() => ({ isOpen: false }));

vi.mock('@/lib/discovery/event-deck-context', () => ({
  useEventDeck: () => deck,
}));

import { SkipToContent } from './skip-to-content';

function renderWithLandmark() {
  const result = render(
    <>
      <SkipToContent targetId="main" />
      <main id="main">content</main>
    </>,
  );
  return result;
}

describe('SkipToContent', () => {
  it('points at the landmark it was given', () => {
    deck.isOpen = false;
    renderWithLandmark();
    expect(screen.getByRole('link', { name: 'Skip to content' }).getAttribute('href')).toBe(
      '#main',
    );
  });

  it('is hidden from sight but never from the tab order', () => {
    deck.isOpen = false;
    renderWithLandmark();
    const link = screen.getByRole('link', { name: 'Skip to content' });
    // `sr-only`, not `hidden` and not `display:none` — the whole point is that
    // a keyboard user can still reach it. A link nobody can Tab to is not an
    // accessibility feature, it is dead markup.
    expect(link.className).toContain('sr-only');
    expect(link.hasAttribute('hidden')).toBe(false);
    expect(link.getAttribute('tabindex')).toBeNull();
  });

  it('reveals itself on KEYBOARD focus only', () => {
    deck.isOpen = false;
    renderWithLandmark();
    const link = screen.getByRole('link', { name: 'Skip to content' });
    // Every reveal variant is `focus-visible:`, never `focus:`. `:focus`
    // matches a pointer press and a programmatic `.focus()` too, and on mobile
    // browsers that focus SURVIVES the tap that set it — which is how a link
    // meant for keyboard users ended up drawn over the logo on a phone.
    expect(link.className).toContain('focus-visible:not-sr-only');
    expect(link.className).not.toMatch(/(^|\s)focus:/);
  });

  it('moves focus to the landmark when activated, so the pill goes away', () => {
    deck.isOpen = false;
    renderWithLandmark();
    const link = screen.getByRole('link', { name: 'Skip to content' });

    fireEvent.click(link);

    const target = document.getElementById('main');
    // THE ONE THAT MADE IT "PERMANENT". A bare `href="#main"` only scrolls —
    // the landmark is not focusable, so focus stayed on the anchor, the App
    // Router does not reset it on a soft navigation, and the pill therefore
    // outlived the press and every route change after it. Sitting exactly on
    // the logo, it then caught the next tap aimed at the logo and renewed
    // itself: a loop that feeds itself.
    expect(target?.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(target);
  });

  it('renders nothing at all while the event deck is open', () => {
    // The deck is a fixed `aria-modal` overlay covering the document, so
    // `#main` is underneath it. Offering a shortcut to covered content — drawn
    // on top of the dialog — is both a dead link and the overlap in the
    // report. Content outside an open modal should be unreachable.
    deck.isOpen = true;
    renderWithLandmark();
    expect(screen.queryByRole('link', { name: 'Skip to content' })).toBeNull();
  });
});
