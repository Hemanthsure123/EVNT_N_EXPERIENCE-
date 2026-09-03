import * as React from 'react';
import Link from 'next/link';
import { Facebook, Instagram, Linkedin, Youtube } from 'lucide-react';
import { Aurora } from '@/components/discovery/aurora';
import { LEGAL_NAME, SOCIAL_HANDLES } from '@/lib/brand';
import { SITE_DESCRIPTION } from '@/lib/seo/metadata';
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
    heading: 'Help',
    links: [
      { label: 'Contact us', href: '/contact' },
      { label: 'Support', href: '/support' },
      { label: 'Refund policy', href: '/refunds' },
    ],
  },
  {
    heading: 'Quick links',
    links: [
      { label: 'Browse events', href: '/events' },
      { label: 'This weekend', href: '/events?when=weekend' },
      { label: 'Hire a band', href: '/hire' },
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

/**
 * ── AN UNCONFIGURED ACCOUNT RENDERS NOTHING ───────────────────────────────
 *
 * These four used to be hard-coded as `https://instagram.com`, `https://x.com`,
 * `https://facebook.com` and `https://youtube.com` — the platforms' front
 * doors, not accounts. Clicking Instagram in the footer of a ticketing site and
 * landing on Instagram's login wall reads as a broken product, and it is the
 * one thing in this footer a visitor could actually catch us at.
 *
 * They come from `lib/brand`'s env-driven `SOCIAL_HANDLES` now, and an unset
 * one is FILTERED OUT rather than rendered dead. With none set the whole `<ul>`
 * is absent and the payment pills take the row on their own — which is the same
 * rule the push card, the OAuth buttons and the health tiles follow: refuse
 * rather than pretend.
 */
const SOCIAL = [
  { label: 'Instagram', href: SOCIAL_HANDLES.instagram, icon: Instagram },
  { label: 'X', href: SOCIAL_HANDLES.x, icon: XMark },
  { label: 'Facebook', href: SOCIAL_HANDLES.facebook, icon: Facebook },
  { label: 'YouTube', href: SOCIAL_HANDLES.youtube, icon: Youtube },
  { label: 'LinkedIn', href: SOCIAL_HANDLES.linkedin, icon: Linkedin },
].filter((s) => s.href.length > 0);

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
    <footer
      className={cn(
        // ── SHAPE, NOT A RECTANGLE ────────────────────────────────────────
        // It was a full-bleed grey band with a hairline on top, which is the
        // default every framework produces and reads as the page simply
        // running out. Rounding the top two corners and letting the page
        // colour show at the shoulders makes it a SLAB the content sits on
        // top of — the same device the ticket panel and the category banner
        // use, so the page ends in the product's own vocabulary.
        //
        // `isolate` because the aurora inside is `-z-10`: without a stacking
        // context of its own it would paint behind the page background and
        // vanish.
        'relative isolate overflow-hidden rounded-t-3xl border-x border-t border-border bg-sunken',
        className,
      )}
    >
      {/* The same drifting field as the front page and the category banner —
          three blurred divs on CSS keyframes, no canvas, no request, stopped
          outright under `prefers-reduced-motion`. Held low so it is a warmth
          under the links rather than something competing with them. */}
      <Aurora className="opacity-40" />
      {/* `py-block-lg` below `sm` rather than the full `py-section`: the band is
          already visually separated by the tint and the hairline, so 32px does
          the job 40px was doing and the saving is free. */}
      <Container className="flex flex-col gap-block py-block-lg sm:py-section lg:gap-block-lg lg:py-section-lg">
        {/* ── CENTRED BRAND, THEN SOCIAL, THEN THE LINK COLUMNS ────────────
            The reference stacks these down the middle of a phone: the mark,
            a row of social glyphs, then the columns. The previous layout put
            the brand on the left with the columns beside it and a marketing
            panel above the lot.

            THAT PANEL IS GONE. "Find something on this week" with two buttons
            was a call to action at the bottom of every page, including the
            checkout screens that later moved out of this layout precisely to
            escape it. A footer's job here is to answer "where do I get help"
            and "what else is there", and it does that with links. */}
        {/* ── AND ON A LAPTOP IT IS A ROW, NOT A NARROW ISLAND ────────────
            Everything below was centred, because everything below was built to
            a phone reference — and nobody re-checked a laptop. The consequence
            was measurable rather than a matter of taste: the link nav is
            `max-w-md` (448px) inside a 1232px content band, and the longest
            string in it is about 92px ("Browse events"), so roughly 180px of
            ink sat in the middle of 1232px with a void either side. It did not
            read as "centred", it read as bunched — which is exactly how it was
            reported.

            From `lg` the brand and the links take opposite ends of one row, the
            way a footer with two link groups is shaped everywhere else. Below
            `lg` NOTHING changes: the centred stack is right on a phone and is
            the layout that was actually reviewed. */}
        <div className="flex flex-col items-center gap-block lg:flex-row lg:items-start lg:justify-between lg:gap-block-lg">
        <div className="flex flex-col items-center gap-stack-lg lg:items-start">
          <Link
            href="/"
            className="inline-flex w-fit items-center rounded-full text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sunken"
          >
            <BrandLockup />
          </Link>

          {/* One line about the product, and it is the SAME sentence the site's
              own metadata uses rather than a second one written for this
              corner — two descriptions of one product is how they drift.
              Hidden below `lg`: the phone footer is a compact stack and a
              paragraph in it is weight nobody asked for. It is what stops the
              left half of a 1900px row being an empty field beside a 24px
              logo. */}
          <p className="hidden max-w-xs text-body-sm text-muted-foreground lg:block">
            {SITE_DESCRIPTION}
          </p>

          {/* Absent entirely when no handle is configured — see the note on
              SOCIAL. An icon linking to a platform's login wall is the one
              thing in this footer a visitor could catch us at. */}
          {SOCIAL.length > 0 && (
            <ul className="flex items-center gap-1" aria-label="Social media">
              {SOCIAL.map((social) => (
                <li key={social.label}>
                  {/* `target`/`rel` because these are the only OFF-SITE links
                      in the shell: without `noopener` the opened tab keeps a
                      handle on this one via `window.opener`. */}
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
          )}
        </div>

        {/* ONE nav landmark, not one per group. Two `<nav aria-label>`s in a
            footer is two entries in a screen reader's landmark list for what is
            one navigation; the groups are headings inside it instead, which is
            what the heading list is for.

            Two columns at every width. There is no `sm:grid-cols-4` any more
            because there are no longer four groups — "Useful links" and the
            app-store badges are gone (there is no app), and Organizers and
            Company folded away with them. */}
        <nav
          aria-label="Footer"
          className={cn(
            'mx-auto grid w-full max-w-md grid-cols-2 gap-x-6 gap-y-block',
            // From `lg` it stops being a centred box and becomes the right-hand
            // half of the row: sized to its content, generous gutter, no
            // auto-margins fighting the flex parent.
            'lg:mx-0 lg:w-auto lg:max-w-none lg:gap-x-block-lg',
          )}
        >
          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <h2 className="text-label uppercase tracking-wide text-foreground-subtle">
                {col.heading}
              </h2>
              {/* No row gap below `sm` — the rows are already 44px tall, and a
                  gap on top of that is pitch nobody asked for. */}
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
        <div
          className={cn(
            'flex flex-col gap-stack border-t border-border pt-block',
            // The same correction as the row above: on a laptop the copyright
            // and the payment pills take opposite ends of one line instead of
            // stacking down the middle of 1232px. `order` rather than DOM
            // reordering, so a phone still reads payments -> copyright ->
            // terms, which is the order that was reviewed.
            'lg:grid lg:grid-cols-2 lg:items-center lg:gap-x-block',
          )}
        >
          {/* One wrapped row: on a phone the icons sit above the pills, from
              `sm` they take opposite ends of the same line. `flex-wrap` +
              `justify-between` degrades correctly — a wrapped line holding one
              item falls back to flex-start rather than centring it. */}
          {/* Payment methods, centred like everything else in this band. The
              social row moved UP beside the brand — the reference groups the
              mark and the glyphs together at the top, and having them here as
              well would be the same four icons twice. */}
          <ul
            className="flex flex-wrap items-center justify-center gap-2 lg:order-2 lg:justify-end"
            aria-label="Accepted payment methods"
          >
            {PAYMENT_METHODS.map((method) => (
              <li
                key={method}
                className="rounded-full border border-border bg-surface px-3 py-1 text-caption text-muted-foreground"
              >
                {method}
              </li>
            ))}
          </ul>

          {/* Copyright first in the DOM so a phone reads it before the legal
              links; from `sm` the two share one line, copyright left. */}
          <div className="flex flex-col items-center gap-1 lg:order-1 lg:flex-row lg:gap-4">
            <p className="text-caption text-muted-foreground">
              © {new Date().getFullYear()} {LEGAL_NAME}
            </p>
            {/* A named list, not a second `<nav>` landmark. `-ml-1 px-1` on the
                links keeps the 44px targets from reading as indented. */}
            <ul
              aria-label="Legal"
              className="flex flex-wrap items-center justify-center gap-x-3"
            >
              {LEGAL_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={cn(inlineLinkClass, 'px-1')}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* The reference carries a line of this kind under the legal row.
              It names only pages that EXIST — terms, cookies and privacy are
              all real routes — rather than the reference's fuller list, which
              includes a content-guidelines page this product does not have. */}
          <p className="mx-auto max-w-sm text-center text-caption text-muted-foreground lg:order-3 lg:col-span-2 lg:mx-0 lg:max-w-none lg:text-left">
            By using {LEGAL_NAME} you agree to our{' '}
            <Link href="/terms" className={inlineLinkClass}>
              Terms
            </Link>
            ,{' '}
            <Link href="/cookies" className={inlineLinkClass}>
              Cookie Policy
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className={inlineLinkClass}>
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </Container>
    </footer>
  );
}
