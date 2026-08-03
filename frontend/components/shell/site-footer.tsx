import * as React from 'react';
import Link from 'next/link';
import { Facebook, Instagram, Youtube } from 'lucide-react';
import { LEGAL_NAME } from '@/lib/brand';
import { cn } from '@/lib/utils/cn';
import { BrandLockup } from './brand-mark';
import { Container } from './container';

/**
 * THE site footer — the one the public shell renders (`app/(site)/layout.tsx`).
 *
 * ── THERE USED TO BE TWO OF THESE ─────────────────────────────────────────
 *
 * `shell/footer.tsx` held a second, near-identical implementation with a
 * DIFFERENT set of links (a "Discover" group this one never had; no Support
 * group, no payment methods, two social icons instead of four). It was rendered
 * only by `/style-guide` — which is the page the axe sweep scans, so the
 * accessibility check was running against a footer no visitor ever saw while
 * the real one went unscanned. That is the drift the duplicate guaranteed.
 * `footer.tsx` is now a re-export of this component, and its unique links
 * (Browse events / This weekend / Popular cities) live here as the Discover
 * group, so consolidating lost nothing.
 *
 * ── THE MOBILE LAYOUT: TWO COLUMNS, NOT FOUR STACKED, NOT AN ACCORDION ────
 *
 * Below `sm` the four link groups were one per row, which made the footer taller
 * than the phone screen — a full viewport of nothing but links under every page.
 * It is a 2×2 grid now.
 *
 * The alternative was collapsible `<details>` groups. Rejected, for a reason
 * specific to this footer rather than a general dislike of accordions:
 *
 *  - A disclosure summary is itself a ~44px row, so four of them cost ~176px
 *    collapsed against ~330px for the open 2-column grid. That saves roughly
 *    150px in exchange for hiding EVERY link behind a tap.
 *  - The groups hold three links each. A disclosure earns its place when a
 *    group has eight or ten items and the list is genuinely unscannable; at
 *    three, the accordion header occupies most of the space its contents would.
 *  - District and BookMyShow both render their mobile footer links expanded,
 *    in a dense multi-column block. Nobody arrives at a footer to browse — they
 *    arrive looking for Refund policy or Terms, in a hurry, and one more tap
 *    between them and it is the wrong trade on exactly that surface.
 *
 * Legal moved OUT of the grid and into the closing band, which is where every
 * comparable product puts it and which is what drops the grid from three rows
 * to two. Nothing was culled: all fifteen links are still here.
 *
 * ── IT IS THE PAGE'S ONE TINTED BAND ──────────────────────────────────────
 *
 * The light theme's canvas is pure white and a card cannot separate from it by
 * value, so the single step DOWN (`--sunken`, a very light warm grey) is spent
 * where it earns the most: the large section at the bottom that is not content.
 * A hairline on top of it says where the page ends. In dark, `--sunken` is the
 * darkest rung of the ladder, so the same class reads as "below the page" in
 * both themes.
 *
 * ── ONE BRAND MARK PER PAGE ───────────────────────────────────────────────
 *
 * `BrandLockup` — the same component the header renders — rather than a second,
 * different mark for the same product, and `LEGAL_NAME` in the copyright.
 *
 * No newsletter block and no app-store badges: there is no mailing list and no
 * app, so both would be promises the product cannot keep.
 */

type FooterLink = { label: string; href: string };
type FooterColumn = { heading: string; links: FooterLink[] };

const COLUMNS: FooterColumn[] = [
  {
    heading: 'Discover',
    links: [
      { label: 'Browse events', href: '/events' },
      { label: 'This weekend', href: '/events?when=weekend' },
      { label: 'Popular cities', href: '/cities' },
    ],
  },
  {
    heading: 'Organizers',
    links: [
      { label: 'List your event', href: '/organizer' },
      { label: 'Organizer login', href: '/organizer' },
      { label: 'Pricing', href: '/pricing' },
    ],
  },
  {
    heading: 'Support',
    links: [
      { label: 'Help center', href: '/help' },
      { label: 'Refund policy', href: '/refunds' },
      { label: 'Contact support', href: '/contact' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Careers', href: '/careers' },
      { label: 'Contact', href: '/contact' },
    ],
  },
];

/**
 * Legal sits in the closing band rather than as a fifth column. It is what
 * takes the mobile grid from three rows to two, and it is where a reader
 * already looks for it — under the copyright, not filed beside "Careers".
 */
const LEGAL_LINKS: FooterLink[] = [
  { label: 'Terms', href: '/terms' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Cookies', href: '/cookies' },
];

/**
 * X's mark is a wordmark, not a bird. lucide still ships `Twitter`, and using
 * it labels a link to a site that has not been called that in years — the sort
 * of small dishonesty that makes everything next to it look unmaintained. Drawn
 * inline because there is nothing to import: `currentColor` and no hex, so it
 * inherits the row's ink like every other glyph here.
 */
function XMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" focusable="false" {...props}>
      <path d="M17.53 3h3.02l-6.6 7.54L21.7 21h-6.06l-4.75-6.2L5.46 21H2.44l7.05-8.06L2.3 3h6.21l4.29 5.67L17.53 3Zm-1.06 16.2h1.67L7.6 4.71H5.81l10.66 14.49Z" />
    </svg>
  );
}

const SOCIAL = [
  { label: 'Instagram', href: 'https://instagram.com', icon: Instagram },
  { label: 'X', href: 'https://x.com', icon: XMark },
  { label: 'Facebook', href: 'https://facebook.com', icon: Facebook },
  { label: 'YouTube', href: 'https://youtube.com', icon: Youtube },
];

// What the payment provider actually supports today — named, not badged with
// brand logos we have neither the assets nor the licence for.
const PAYMENT_METHODS = ['UPI', 'Cards', 'Net banking', 'Wallets'];

/**
 * A footer link is a 44px row below `sm` and a plain 20px line above it.
 *
 * The floor is there because a phone footer is thumb territory — the same
 * reason the account menu's rows are `min-h-control`. It is DROPPED above `sm`
 * because a pointer does not need it, and fifteen links at 44px each is a large
 * part of what made this footer a screen of its own. `min-h-` rather than
 * `h-`: a label that wraps must be allowed to grow.
 */
const LINK_BASE =
  'min-h-control items-center rounded-sm text-body-sm text-muted-foreground transition-colors duration-fast ease-out hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0';

/** Column links own their row. */
const linkClass = `flex ${LINK_BASE}`;
/** Legal links sit inline in a wrapped row, so they size to their label. */
const inlineLinkClass = `inline-flex ${LINK_BASE}`;

export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer className={cn('border-t border-border bg-sunken', className)}>
      {/* `py-block-lg` below `sm` rather than the full `py-section`: the band is
          already visually separated by the tint and the hairline, so 32px does
          the job 40px was doing and the saving is free. */}
      <Container className="flex flex-col gap-block py-block-lg sm:py-section lg:gap-block-lg lg:py-section-lg">
        <div className="flex flex-col gap-block lg:flex-row lg:items-start lg:justify-between lg:gap-block-lg">
          {/* Brand + one line. `max-w-xs` only from `lg`, where it sits beside
              the columns; narrower than that it has the row to itself. */}
          <div className="flex flex-col gap-2 lg:max-w-xs">
            <Link
              href="/"
              className="inline-flex w-fit items-center rounded-full text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sunken"
            >
              <BrandLockup />
            </Link>
            <p className="text-body-sm text-muted-foreground">
              Discover live events and get in with a single scan.
            </p>
          </div>

          {/* ONE nav landmark, not one per group. Four `<nav aria-label>`s in a
              footer is four entries in a screen reader's landmark list for what
              is one navigation; the groups are headings inside it instead, which
              is what the heading list is for. */}
          <nav
            aria-label="Footer"
            className="grid grid-cols-2 gap-x-4 gap-y-block sm:grid-cols-4 sm:gap-x-6 lg:gap-x-block-lg"
          >
            {COLUMNS.map((col) => (
              <div key={col.heading}>
                <h2 className="text-label uppercase tracking-wide text-foreground-subtle">
                  {col.heading}
                </h2>
                {/* No row gap below `sm` — the rows are already 44px tall, and
                    a gap on top of that is pitch nobody asked for. */}
                <ul className="mt-1 flex flex-col sm:mt-stack sm:gap-2">
                  {col.links.map((link) => (
                    <li key={`${col.heading}-${link.label}`}>
                      <Link href={link.href} className={linkClass}>
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* ── The closing band: social, payments, copyright, legal ────────── */}
        <div className="flex flex-col gap-stack border-t border-border pt-block">
          {/* One wrapped row: on a phone the icons sit above the pills, from
              `sm` they take opposite ends of the same line. `flex-wrap` +
              `justify-between` degrades correctly — a wrapped line holding one
              item falls back to flex-start rather than centring it. */}
          <div className="flex flex-wrap items-center justify-between gap-x-block gap-y-stack">
            {/* `-ml-3` pulls the first 44px hit area back so the GLYPH, not the
                target's edge, lines up with the text above it. */}
            <ul className="-ml-3 flex items-center gap-1" aria-label="Social media">
              {SOCIAL.map((social) => (
                <li key={social.label}>
                  {/* `target`/`rel` because these are the only OFF-SITE links in
                      the shell: without `noopener` the opened tab keeps a handle
                      on this one via `window.opener`. */}
                  <Link
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${social.label} (opens in a new tab)`}
                    className="inline-flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast ease-out hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <social.icon className="size-5" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>

            <ul className="flex flex-wrap items-center gap-2" aria-label="Accepted payment methods">
              {PAYMENT_METHODS.map((method) => (
                <li
                  key={method}
                  className="rounded-full border border-border bg-surface px-3 py-1 text-caption text-muted-foreground"
                >
                  {method}
                </li>
              ))}
            </ul>
          </div>

          {/* Copyright first in the DOM so a phone reads it before the legal
              links; from `sm` the two share one line, copyright left. */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-x-block">
            <p className="text-caption text-muted-foreground">
              © {new Date().getFullYear()} {LEGAL_NAME}
            </p>
            {/* A named list, not a second `<nav>` landmark. `-ml-1 px-1` on the
                links keeps the 44px targets from reading as indented. */}
            <ul aria-label="Legal" className="-ml-1 flex flex-wrap items-center gap-x-3">
              {LEGAL_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={cn(inlineLinkClass, 'px-1')}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Container>
    </footer>
  );
}
