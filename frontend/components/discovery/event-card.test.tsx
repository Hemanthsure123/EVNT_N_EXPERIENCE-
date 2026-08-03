import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { EventCard as EventCardData } from '@/lib/api/types';
import { EventCard } from './event-card';

const SIZES = '100vw';

const build = (over: Partial<EventCardData> = {}): EventCardData => ({
  id: 'evt-1',
  title: 'Zakir Khan: Papa Yaar',
  venue: 'Canvas Laugh Club',
  city: 'Mumbai',
  starts_at: '2026-08-01T14:30:00.000Z',
  poster_url: 'http://localhost:8000/media/posters/1.png',
  from_price: 49900,
  tickets_available: 200,
  organization_id: 'org-1',
  organization_name: 'OML',
  ...over,
});

describe('EventCard', () => {
  it('makes the WHOLE card one tap target, with exactly one link to the event', () => {
    render(<EventCard event={build()} sizes={SIZES} />);

    // ONE link, named by the title. The card used to wrap everything in the
    // anchor, which made its accessible name the entire card — title, date,
    // venue, organiser and price read out as one run-on link. It's now a
    // stretched link: the anchor holds only the title, and a pseudo-element
    // covers the card, so the hit area is unchanged and the name is the title.
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/events/evt-1');
    expect(link).toHaveAccessibleName('Zakir Khan: Papa Yaar');
    expect(link.className).toContain('after:absolute');
    expect(link.className).toContain('after:inset-0');

    // ...and the rest of the card is still there, outside the anchor.
    expect(screen.getByText('Canvas Laugh Club, Mumbai')).toBeInTheDocument();
  });

  it('renders the date in the platform timezone with a machine-readable time', () => {
    render(<EventCard event={build()} sizes={SIZES} />);
    // 14:30 UTC is 20:00 IST on 1 Aug 2026 (a Saturday).
    expect(screen.getByText(/Sat, 1 Aug/)).toBeInTheDocument();
    expect(screen.getByText(/8:00 pm/i)).toBeInTheDocument();
    expect(document.querySelector('time')).toHaveAttribute('datetime', '2026-08-01T14:30:00.000Z');
  });

  it('shows "from ₹499" for a paid event', () => {
    render(<EventCard event={build()} sizes={SIZES} />);
    expect(screen.getByText(/from/)).toBeInTheDocument();
    expect(screen.getByText('₹499')).toBeInTheDocument();
  });

  it('says "Free", never "from Free"', () => {
    render(<EventCard event={build({ from_price: 0 })} sizes={SIZES} />);
    expect(screen.queryByText(/from/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Free').length).toBeGreaterThan(0);
  });

  it('distinguishes "not priced yet" (null) from free', () => {
    render(
      <EventCard event={build({ from_price: null, tickets_available: null })} sizes={SIZES} />,
    );
    expect(screen.getByText('Pricing soon')).toBeInTheDocument();
    expect(screen.queryByText('Free')).not.toBeInTheDocument();
  });

  it('badges scarcity, and spells the number out for screen readers', () => {
    render(<EventCard event={build({ tickets_available: 3 })} sizes={SIZES} />);
    expect(screen.getByText('Few left')).toBeInTheDocument();
    expect(screen.getByText('Only 3 tickets left')).toBeInTheDocument();
  });

  it('badges sold out', () => {
    render(<EventCard event={build({ tickets_available: 0 })} sizes={SIZES} />);
    expect(screen.getByText('Sold out')).toBeInTheDocument();
  });

  it('infers a category chip from the title', () => {
    render(<EventCard event={build({ title: 'Improv Comedy Jam' })} sizes={SIZES} />);
    expect(screen.getByText('Comedy')).toBeInTheDocument();
  });

  it('omits the category chip rather than guessing wrong', () => {
    render(<EventCard event={build({ title: 'Xyzzy', venue: 'Somewhere' })} sizes={SIZES} />);
    expect(screen.queryByText('Comedy')).not.toBeInTheDocument();
    expect(screen.queryByText('Concerts')).not.toBeInTheDocument();
  });

  // PORTRAIT, not 3:2. The card is a 3:4 poster with the text below it, so the
  // reserved box is `aspect-portrait` — see the note in event-card.tsx.
  it('reserves the poster box and leaves the image decorative (the title is the label)', () => {
    const { container } = render(<EventCard event={build()} sizes={SIZES} />);
    expect(container.querySelector('.aspect-portrait')).toBeInTheDocument();
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
  });

  it('falls back to a designed tile when the event has no poster', () => {
    const { container } = render(<EventCard event={build({ poster_url: '' })} sizes={SIZES} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.aspect-portrait')).toBeInTheDocument();
  });

  // ── THE COMPACT ROW ──────────────────────────────────────────────────────
  // Below `sm` the same markup lays out as a 96px-thumbnail row rather than as
  // a 731px portrait card (one per phone screen). These assertions are on the
  // CLASSES because jsdom has no layout and no media queries — what can be
  // checked is that the responsive pair is present on the two elements that
  // carry the shape, which is exactly what a stray `flex-col` would break.
  it('lays out as a row on a phone and as a portrait card from sm', () => {
    const { container } = render(<EventCard event={build()} sizes={SIZES} />);

    const poster = container.querySelector('.aspect-portrait');
    // 96px thumbnail below `sm`, full-bleed above it. ONE image, not two —
    // a hidden `next/image` is still fetched.
    expect(poster?.className).toContain('w-24');
    expect(poster?.className).toContain('sm:w-full');
    expect(container.querySelectorAll('img')).toHaveLength(1);

    const card = poster?.parentElement;
    expect(card?.className).toContain('flex-row');
    expect(card?.className).toContain('sm:flex-col');
  });

  it('keeps every fact that answers when / where / how much on the compact row', () => {
    render(<EventCard event={build({ tickets_available: 3 })} sizes={SIZES} />);
    // Nothing that decides a booking is dropped at any width; only the
    // category chip, the organiser line and the hover-only arrow are.
    expect(screen.getByText(/Sat, 1 Aug/)).toBeInTheDocument();
    expect(screen.getByText('Canvas Laugh Club, Mumbai')).toBeInTheDocument();
    expect(screen.getByText('₹499')).toBeInTheDocument();
    expect(screen.getByText('Few left')).toBeInTheDocument();
  });

  it('gives the save control a 44px target on the row and 36px on the poster', () => {
    render(<EventCard event={build()} sizes={SIZES} />);
    // Density is not a licence to shrink a target: it is `size-11` in the
    // row's footer, and only drops to `size-9` at `sm`, where it becomes an
    // overlay on a full-width poster.
    const save = screen.getByRole('button', { name: /save/i });
    expect(save.className).toContain('size-11');
    expect(save.className).toContain('sm:size-9');
  });
});
