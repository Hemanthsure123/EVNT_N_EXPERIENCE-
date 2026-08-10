import * as React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Container } from '@/components/shell/container';
import { cn } from '@/lib/utils/cn';

/**
 * ── THE STATIC PAGES' SHARED FURNITURE ────────────────────────────────────
 *
 * Ten routes landed at once — four policy documents, two support pages, two
 * company pages and two supply pages. Every one of them was already LINKED from
 * the footer of every page on the site and every one of them 404'd.
 *
 * They share this file rather than each rolling its own header, because ten
 * pages built independently is ten slightly different measures, ten heading
 * ladders and ten opinions about how wide a paragraph should be — which is
 * precisely how a site's "about" page ends up looking like it came from a
 * different product than its "pricing" page. Anything with a real opinion in it
 * lives here once.
 *
 * These are SERVER components with no client boundary. The FAQ list uses native
 * `<details>` rather than a JS accordion for the same reason: a policy page
 * that needs hydration before its content can be read is a policy page that
 * fails for the crawler, for reader mode, and for Ctrl+F.
 */

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The page header.
 *
 * The illustration sits BESIDE the text on desktop and ABOVE it on a phone,
 * rather than being dropped for narrow viewports. A spot is 96px — it costs
 * almost nothing vertically, and these pages are the ones a visitor arrives at
 * with a problem ("how do I get a refund"), where a single warm mark is the
 * difference between a document and a wall.
 *
 * `lead` is `text-body-lg` and capped at `max-w-2xl`: roughly 70 characters,
 * which is the measure the rest of the product uses for long-form text.
 */
export function PageHeader({
  eyebrow,
  title,
  lead,
  illustration,
  children,
  className,
}: {
  eyebrow?: string;
  title: string;
  lead?: React.ReactNode;
  /** A `Spot*` from `components/illustrations`. Decorative — it is `aria-hidden` already. */
  illustration?: React.ReactNode;
  /** Actions, meta rows, a last-updated line. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-col gap-6 pt-8 sm:pt-10 lg:pt-12', className)}>
      <div className="flex flex-col-reverse items-start gap-6 sm:flex-row sm:items-center sm:justify-between sm:gap-10">
        <div className="flex flex-col gap-3">
          {eyebrow ? (
            <div className="flex flex-col gap-1.5 sm:gap-2">
              {/* The same short rule `SectionHeader` uses. One recurring mark
                  across the product rather than a new decoration per page. */}
              <span className="h-0.5 w-8 rounded-full bg-foreground sm:w-10" aria-hidden />
              <span className="text-label uppercase tracking-wide text-foreground-subtle">
                {eyebrow}
              </span>
            </div>
          ) : null}
          <h1 className="text-h2 sm:text-h1">{title}</h1>
          {lead ? <p className="max-w-2xl text-body-lg text-muted-foreground">{lead}</p> : null}
        </div>
        {illustration ? <div className="shrink-0">{illustration}</div> : null}
      </div>
      {children}
    </header>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Long-form prose, styled by element rather than by class.
 *
 * The project has no `@tailwindcss/typography` and should not gain one for ten
 * pages: that plugin ships its own type scale and colour ramp, which would put
 * a second, competing set of values next to `styles/tokens.css` — the exact
 * thing `local-rules/no-raw-values` exists to prevent. This is thirty lines of
 * descendant selectors over the tokens the product already has.
 *
 * `max-w-prose-measure` is not a Tailwind default; the measure is set with the
 * container's own `max-w-2xl` so it stays on the scale.
 */
export function Prose({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex max-w-2xl flex-col text-body text-muted-foreground',
        // Vertical rhythm: paragraphs breathe, headings get a bigger gap ABOVE
        // than below so a section reads as attached to its own heading.
        '[&_p:first-child]:mt-0 [&_p]:mt-4',
        '[&_h2:first-child]:mt-0 [&_h2]:mt-10 [&_h2]:text-h4 [&_h2]:text-foreground',
        '[&_h3]:mt-8 [&_h3]:text-body-lg [&_h3]:font-semibold [&_h3]:text-foreground',
        '[&_ul]:mt-4 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-5',
        '[&_ol]:mt-4 [&_ol]:flex [&_ol]:flex-col [&_ol]:gap-2 [&_ol]:pl-5',
        '[&_li]:list-outside [&_ol>li]:list-decimal [&_ul>li]:list-disc',
        '[&_li::marker]:text-foreground-subtle',
        '[&_strong]:font-semibold [&_strong]:text-foreground',
        // Links inside prose are underlined. In a body of grey text an
        // unmarked colour change is the one affordance people genuinely miss,
        // and these pages are read by somebody trying to get somewhere.
        '[&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4',
        '[&_a:hover]:text-primary',
        '[&_a:focus-visible]:outline-none [&_a:focus-visible]:ring-2 [&_a:focus-visible]:ring-ring [&_a]:rounded-sm',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

export type DocSection = {
  /** Anchor id. Also what the table of contents links to. */
  id: string;
  heading: string;
  body: React.ReactNode;
};

/**
 * A policy document: a sticky table of contents beside numbered sections.
 *
 * ── THE CONTENTS LIST IS NOT DECORATION ───────────────────────────────────
 *
 * Nobody reads a refund policy top to bottom. They arrive from a link, with one
 * question, and they need to find the paragraph that answers it — so the
 * contents list is the page's primary navigation and each section carries a
 * real `id`, which is what makes a support reply able to link to
 * `/refunds#cancelled-events` rather than to "the refund policy, third section".
 *
 * It is `position: sticky` from `lg` only. Below that it renders as a plain
 * jump list at the top, which is what a phone can actually use — a sticky
 * sidebar on a 390px viewport is a sidebar that has eaten the content.
 *
 * ── HEADINGS ARE `h2`, AND THEY ARE NUMBERED IN THE MARKUP ────────────────
 *
 * The number is a `<span>` inside the heading rather than a CSS counter, so it
 * is present for a screen reader and survives copy-paste into an email — which
 * is what somebody quoting clause 4 back at support will do.
 */
export function LegalDocument({
  sections,
  intro,
}: {
  sections: readonly DocSection[];
  /** Rendered above the first section, outside the numbering. */
  intro?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-10 lg:flex-row lg:gap-16">
      <nav aria-label="On this page" className="lg:sticky lg:top-24 lg:h-fit lg:w-64 lg:shrink-0">
        <h2 className="text-label uppercase tracking-wide text-foreground-subtle">On this page</h2>
        <ol className="mt-3 flex flex-col gap-0.5">
          {sections.map((section, index) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="flex min-h-control items-center gap-3 rounded-sm text-body-sm text-muted-foreground transition-colors duration-fast ease-out hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-0 lg:py-1"
              >
                <span className="tabular-nums text-foreground-subtle">{index + 1}</span>
                {section.heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="min-w-0 flex-1">
        {intro ? <Prose className="mb-10">{intro}</Prose> : null}
        <div className="flex flex-col gap-10">
          {sections.map((section, index) => (
            <section key={section.id} id={section.id} className="scroll-mt-24">
              <h2 className="flex gap-3 text-h4 text-foreground">
                <span className="tabular-nums text-foreground-subtle">{index + 1}.</span>
                {section.heading}
              </h2>
              <Prose className="mt-3">{section.body}</Prose>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * "Last reviewed" — a date, and what it is a date OF.
 *
 * A bare "Last updated 12 March" on a policy page is ambiguous in the way that
 * matters: it could mean the terms changed, or that somebody fixed a typo. This
 * says which, because a customer who has already agreed to a version needs to
 * know whether there is a new one.
 *
 * The date is passed in as a literal string rather than computed from the file
 * or from `new Date()`. A policy that claims to have been reviewed today,
 * every day, because it renders `Date.now()`, is worse than an old date — it is
 * an assertion nobody made.
 */
export function LastReviewed({ date, note }: { date: string; note?: string }) {
  return (
    <p className="text-body-sm text-foreground-subtle">
      <span className="font-medium text-muted-foreground">Last reviewed {date}.</span>
      {note ? ` ${note}` : null}
    </p>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

export type Faq = { q: string; a: React.ReactNode };

/**
 * An FAQ list, built on native `<details>`/`<summary>`.
 *
 * No client component, no hydration, no `useState`. Three things come free with
 * the native element that a hand-rolled accordion has to reimplement and
 * usually gets partly wrong: keyboard operation, the browser's own find-in-page
 * being able to OPEN a closed section to reveal a match, and rendering fully
 * expanded when the page is printed or read by a crawler.
 *
 * `open` on the first item of a group, optionally — a fully-closed list gives a
 * reader nothing to anchor on and looks like a page that failed to load.
 */
export function FaqList({
  items,
  openFirst = false,
  className,
}: {
  items: readonly Faq[];
  openFirst?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col divide-y divide-border border-y border-border', className)}>
      {items.map((item, index) => (
        <details key={item.q} open={openFirst && index === 0} className="group">
          <summary
            className={cn(
              'flex min-h-control cursor-pointer list-none items-center justify-between gap-4 py-4 text-left',
              'text-body font-medium text-foreground transition-colors duration-fast ease-out hover:text-primary',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              // Safari still paints its own disclosure triangle without this.
              '[&::-webkit-details-marker]:hidden',
            )}
          >
            {item.q}
            {/* A plus that becomes a minus. Rotation only, so it animates
                without a second glyph and is inert under reduced motion. */}
            <span
              aria-hidden
              className="relative size-5 shrink-0 text-foreground-subtle transition-transform duration-base ease-spring group-open:rotate-45 motion-reduce:transition-none"
            >
              <span className="absolute left-1/2 top-1/2 h-0.5 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />
              <span className="absolute left-1/2 top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />
            </span>
          </summary>
          {/* Room, and a line. An answer that starts flush under the
              question reads as a caption on it rather than as the body of the
              disclosure — and these answers are paragraphs. */}
          <Prose className="border-t border-border pb-6 pt-4">{item.a}</Prose>
        </details>
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * A numbered sequence — "how it works".
 *
 * An `<ol>`, because the order is the content. The connecting rule is drawn
 * with a border on the list item rather than an absolutely-positioned element,
 * so it cannot desynchronise from a step whose text wraps to three lines.
 */
export function Steps({
  steps,
  className,
}: {
  steps: readonly { title: string; body: React.ReactNode }[];
  className?: string;
}) {
  return (
    <ol className={cn('flex flex-col', className)}>
      {steps.map((step, index) => (
        <li
          key={step.title}
          className={cn(
            'flex gap-4 pb-6 pl-2 sm:gap-5',
            // Every step but the last carries the rule down its left edge.
            index < steps.length - 1 && 'border-l border-border',
            index === steps.length - 1 && 'pb-0',
          )}
        >
          {/* `-ml-5` is exactly half of `size-10`, which centres the medallion
              on the rule its `border-l` draws. */}
          <span
            className={cn(
              '-ml-5 flex size-10 shrink-0 items-center justify-center rounded-full',
              'border border-border bg-surface text-label tabular-nums text-foreground shadow-sm',
            )}
            aria-hidden
          >
            {index + 1}
          </span>
          <div className="flex flex-col gap-1.5 pt-1.5">
            <h3 className="text-body font-semibold text-foreground">{step.title}</h3>
            <div className="text-body-sm text-muted-foreground">{step.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * A grid of small feature cards.
 *
 * `auto-fit` with a floor rather than a fixed column count, so three items and
 * six items both fill the row instead of one of them leaving a hole.
 */
export function FeatureGrid({
  features,
  className,
}: {
  features: readonly { icon?: React.ReactNode; title: string; body: React.ReactNode }[];
  className?: string;
}) {
  return (
    <ul className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {features.map((feature) => (
        <li
          key={feature.title}
          className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-card shadow-sm"
        >
          {feature.icon ? (
            <span
              className="flex size-10 items-center justify-center rounded-lg bg-muted text-foreground"
              aria-hidden
            >
              {feature.icon}
            </span>
          ) : null}
          <h3 className="text-body font-semibold text-foreground">{feature.title}</h3>
          <p className="text-body-sm text-muted-foreground">{feature.body}</p>
        </li>
      ))}
    </ul>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The closing call to action.
 *
 * ONE filled pill, and at most one hairline pill beside it — the same rule the
 * event page follows. Two filled buttons of equal weight is not a call to
 * action; it is a question.
 */
export function CtaBand({
  title,
  body,
  primary,
  secondary,
  className,
}: {
  title: string;
  body?: React.ReactNode;
  primary: { href: string; label: string };
  secondary?: { href: string; label: string };
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-5 rounded-2xl border border-border bg-sunken p-card-lg sm:p-8',
        'md:flex-row md:items-center md:justify-between md:gap-10',
        className,
      )}
    >
      <div className="flex flex-col gap-2">
        <h2 className="text-h4 text-foreground sm:text-h3">{title}</h2>
        {body ? <p className="max-w-xl text-body-sm text-muted-foreground">{body}</p> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <Link
          href={primary.href}
          className="group inline-flex h-control-lg items-center gap-2 rounded-full bg-cta px-pill-lg text-body font-semibold text-cta-foreground shadow-sm transition duration-fast ease-out hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sunken active:scale-[0.98] motion-reduce:active:scale-100"
        >
          {primary.label}
          <ArrowRight
            className="size-4 transition-transform duration-base ease-spring group-hover:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
            aria-hidden
          />
        </Link>
        {secondary ? (
          <Link
            href={secondary.href}
            className="inline-flex h-control-lg items-center rounded-full border border-border bg-surface px-pill-lg text-body font-medium text-foreground transition-colors duration-fast ease-out hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sunken"
          >
            {secondary.label}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The page wrapper. One measure, one rhythm, one bottom margin.
 *
 * Every static page renders exactly this, so none of them has to remember what
 * the gutter or the closing space is.
 */
export function StaticPage({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Container className={cn('flex flex-col gap-10 pb-16 sm:gap-12 sm:pb-20', className)}>
      {children}
    </Container>
  );
}
