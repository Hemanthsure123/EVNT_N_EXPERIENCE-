import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Footer } from './footer';
import { SiteFooter } from './site-footer';

/**
 * The mobile footer was compacted from four stacked full-width columns to a
 * 2×2 grid plus a closing legal band. The point of these tests is that it was a
 * COMPACTION and not a cull: a layout change that quietly drops "Refund policy"
 * looks identical in review to one that does not.
 *
 * jsdom has no layout engine, so nothing here can assert a height. What it can
 * assert is the set of destinations and the structure that makes the compaction
 * safe — which is the part a screenshot would not catch anyway.
 */

/** Every href the footer is responsible for reaching. */
const EXPECTED_LINKS = [
  // Discover
  '/events',
  '/events?when=weekend',
  '/cities',
  // Organizers
  '/organizer',
  '/pricing',
  // Support
  '/help',
  '/refunds',
  '/contact',
  // Company
  '/about',
  '/careers',
  // Legal — moved out of the grid into the closing band, NOT dropped
  '/terms',
  '/privacy',
  '/cookies',
];

describe('SiteFooter', () => {
  it('still reaches every destination after the compaction', () => {
    render(<SiteFooter />);
    const footer = screen.getByRole('contentinfo');
    const hrefs = Array.from(footer.querySelectorAll('a')).map((a) => a.getAttribute('href'));

    for (const href of EXPECTED_LINKS) {
      expect(hrefs, `${href} disappeared from the footer`).toContain(href);
    }
  });

  it('keeps the legal links, which the compaction moved rather than removed', () => {
    render(<SiteFooter />);
    const legal = screen.getByRole('list', { name: 'Legal' });
    expect(within(legal).getByRole('link', { name: 'Terms' })).toBeInTheDocument();
    expect(within(legal).getByRole('link', { name: 'Privacy' })).toBeInTheDocument();
    expect(within(legal).getByRole('link', { name: 'Cookies' })).toBeInTheDocument();
  });

  it('exposes ONE navigation landmark, not one per link group', () => {
    render(<SiteFooter />);
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getAllByRole('navigation')).toHaveLength(1);
    // The groups are headings inside that one landmark.
    expect(within(footer).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Discover',
      'Organizers',
      'Support',
      'Company',
    ]);
  });

  it('opens off-site social links safely and says so in the label', () => {
    render(<SiteFooter />);
    const social = screen.getByRole('list', { name: 'Social media' });
    for (const link of within(social).getAllByRole('link')) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
      expect(link.getAttribute('aria-label')).toMatch(/opens in a new tab/);
    }
  });

  it('names the payment methods rather than badging them', () => {
    render(<SiteFooter />);
    const methods = screen.getByRole('list', { name: 'Accepted payment methods' });
    expect(within(methods).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'UPI',
      'Cards',
      'Net banking',
      'Wallets',
    ]);
  });

  it('passes a caller className through to the root, which is how the layout clears the bottom nav', () => {
    render(<SiteFooter className="pb-block" />);
    expect(screen.getByRole('contentinfo')).toHaveClass('pb-block');
  });
});

describe('the deprecated Footer alias', () => {
  /**
   * There were two footers with different link sets, and only the dead one was
   * being axe-scanned. This asserts they cannot diverge again.
   */
  it('is the same component as SiteFooter', () => {
    expect(Footer).toBe(SiteFooter);
  });
});
