import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Footer } from './footer';
import { SiteFooter } from './site-footer';

/**
 * The footer's contract.
 *
 * ── IT WAS A COMPACTION; NOW IT IS DELIBERATELY A CULL ────────────────────
 *
 * These tests were written when four stacked columns became a 2×2 grid, to
 * prove the change was a COMPACTION and not a cull — a layout change that
 * quietly drops "Refund policy" looks identical in review to one that does not.
 *
 * The footer is now two columns, Help and Quick links, specified link by link
 * by the product owner. That IS a cull, and the guarantee this file makes has
 * to change with it: the list below is no longer "everywhere the footer used to
 * reach", it is "everywhere the footer is responsible for reaching NOW".
 *
 * The dropped destinations were checked for reachability rather than assumed:
 * `/organizer`, `/dashboard`, `/pricing`, `/help` and `/about` are all linked
 * from elsewhere (the account menu, the organiser page, the contact page).
 * `/careers` was NOT — nothing else in the product linked to it, so removing it
 * here would have orphaned the page outright. It is linked from `/about` now,
 * which is the page somebody is already on when they wonder whether we are
 * hiring. An orphaned route is the failure mode this codebase already names for
 * the performer profiles: a crawler cannot reach a page nothing links to, and
 * neither can a person.
 *
 * jsdom has no layout engine, so nothing here can assert a height. What it can
 * assert is the set of destinations and the structure — which is the part a
 * screenshot would not catch anyway.
 */

/** Every href the footer is responsible for reaching. */
const EXPECTED_LINKS = [
  // Help
  '/contact',
  '/support',
  '/refunds',
  // Quick links
  '/events',
  '/events?when=weekend',
  '/hire',
  // Legal — in the closing band, NOT dropped
  '/terms',
  '/privacy',
  '/cookies',
];

describe('SiteFooter', () => {
  // One test mocks `@/lib/brand` and re-imports the component; without this the
  // mock leaks into every test that runs after it in this file.
  afterEach(() => {
    vi.doUnmock('@/lib/brand');
    vi.resetModules();
  });

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
    expect(
      within(footer)
        .getAllByRole('heading', { level: 2 })
        .map((h) => h.textContent),
    ).toEqual(['Help', 'Quick links']);
  });

  /**
   * ── THE SOCIAL ROW USED TO LINK TO NOTHING ──────────────────────────────
   *
   * Its four icons were hard-coded to `https://instagram.com`, `https://x.com`,
   * `https://facebook.com` and `https://youtube.com` — the platforms' own front
   * doors rather than accounts. Clicking Instagram in the footer of a ticketing
   * site and landing on Instagram's login wall reads as a broken product, and
   * it was the one thing in this footer a visitor could actually catch us at.
   *
   * They are env-driven now (`SOCIAL_HANDLES` in `lib/brand`) and an unset one
   * is filtered out. Both halves need a test, because each fails silently in a
   * different direction: an unconfigured deploy that renders dead links, or a
   * configured one whose links lost `rel="noopener"` in a refactor.
   */
  it('renders NO social row at all when no handle is configured', () => {
    render(<SiteFooter />);
    expect(screen.queryByRole('list', { name: 'Social media' })).not.toBeInTheDocument();
  });

  it('never links to a bare platform front door', () => {
    render(<SiteFooter />);
    const hrefs = Array.from(screen.getByRole('contentinfo').querySelectorAll('a')).map(
      (a) => a.getAttribute('href') ?? '',
    );
    // The exact four that used to be here. A regression would reintroduce one
    // of these literals, so match them rather than a general "is it off-site".
    for (const dead of [
      'https://instagram.com',
      'https://x.com',
      'https://facebook.com',
      'https://youtube.com',
    ]) {
      expect(hrefs, `${dead} is a login wall, not an account`).not.toContain(dead);
    }
  });

  it('opens off-site social links safely once handles ARE configured', async () => {
    vi.resetModules();
    vi.doMock('@/lib/brand', () => ({
      BRAND_NAME: 'Curatix',
      LEGAL_NAME: 'Curatix',
      SITE_NAME: 'Curatix',
      SUPPORT_EMAIL: '',
      SUPPORT_PHONE: '',
      REGISTERED_ADDRESS: '',
      GSTIN: '',
      SOCIAL_HANDLES: {
        instagram: 'https://instagram.com/curatix',
        x: '',
        facebook: '',
        youtube: 'https://youtube.com/@curatix',
        linkedin: '',
      },
    }));

    const { SiteFooter: Configured } = await import('./site-footer');
    render(<Configured />);

    const social = screen.getByRole('list', { name: 'Social media' });
    const links = within(social).getAllByRole('link');
    // Two configured, three blank — the blanks are filtered, not rendered dead.
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
      expect(link.getAttribute('aria-label')).toMatch(/opens in a new tab/);
    }
  });

  it('names the payment methods rather than badging them', () => {
    render(<SiteFooter />);
    const methods = screen.getByRole('list', { name: 'Accepted payment methods' });
    expect(
      within(methods)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['UPI', 'Cards', 'Net banking', 'Wallets']);
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
