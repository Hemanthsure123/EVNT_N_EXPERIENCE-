import * as React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Container } from '@/components/shell/container';
import { Reveal } from './reveal';
import { cn } from '@/lib/utils/cn';

/**
 * Section chrome — the page's rhythm, in one place.
 *
 * Vertical spacing comes from ONE pair of tokens (`--space-section` /
 * `--space-section-lg`, 48/80px) rather than each block choosing its own
 * padding. That is what makes the page scan as a single document instead of a
 * stack of unrelated widgets, and it means the whole rhythm is retuned by
 * editing two values.
 */

/**
 * Section heading. The short rule above the title is the recurring motif that
 * ties the sections together — one mark, used identically everywhere, instead
 * of each section reaching for a different decoration.
 *
 * It is INK now, not a violet→pink gradient. A 40px bar repeated above every
 * heading on the page was the single most frequent appearance of the brand
 * gradient in the product, and in a light-first language where the primary
 * action is near-black the same mark in `--foreground` reads as a considered
 * typographic rule rather than as decoration. The heading itself carries more
 * of the weight now too: `text-h2` is 32/700 with tightened tracking.
 *
 * "See all" is a bordered neutral pill rather than violet text. It is a
 * secondary route out of the section, and the one obvious action on any of
 * these screens should not have competition from eight section links.
 *
 * THE TITLE STEPS DOWN ONE MORE RUNG ON A PHONE (`h4` → `h3` → `h2`, 20/24/32).
 * It used to start at `h3`: 24/700 at 390px, on a heading whose whole job is to
 * label the block under it, is only a few points off the page's own `h1` and
 * costs 32px of the fold every time it appears. Five sections down the home
 * page that is a screenful of headings.
 */
export function SectionHeader({
  title,
  subtitle,
  href,
  linkLabel = 'See all',
  className,
}: {
  title: string;
  subtitle?: string;
  href?: string;
  linkLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-2', className)}>
      <div className="flex flex-col gap-1.5 sm:gap-2">
        <h2 className="text-h4 font-extrabold tracking-tight sm:text-h3 md:text-h2">{title}</h2>
        {subtitle ? (
          <p className="text-caption text-muted-foreground sm:text-body-sm">{subtitle}</p>
        ) : null}
      </div>
      {href ? (
        <Link
          href={href}
          className={cn(
            'group inline-flex h-control shrink-0 items-center gap-2 rounded-full border border-border bg-surface px-pill text-label text-foreground',
            // A hover target you can see. This was a colour shift on text with
            // no bounds, so there was no way to tell where the link began
            // until the cursor happened to land on a glyph. It is now a real
            // bordered pill, which also gives it the 44px touch target that a
            // bare text link on a phone never had.
            'transition-[color,background-color,border-color,transform] duration-base ease-spring hover:border-border-strong hover:bg-muted',
            'active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          )}
        >
          {linkLabel}
          <ArrowRight
            className="size-4 transition-transform duration-base ease-spring group-hover:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
            aria-hidden
          />
        </Link>
      ) : null}
    </div>
  );
}

/**
 * A full-width page section on the canonical rhythm.
 *
 * The 32px gap between a heading and its content is a desktop measure. At
 * 390px it is a third of the space the content itself gets, and repeated down
 * a home page of six sections it is 100px of scroll spent on nothing — so it
 * drops to 20px below `sm`. The `py-section` rung is already the mobile value
 * (40px, see tokens.css) and is left alone: that gap is what separates two
 * IDEAS, and collapsing it is how a page turns into a list.
 */
export function Section({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn('py-section lg:py-section-lg', className)} {...props}>
      {/* Every home section fades up once, the first time it is scrolled to.
          Applied HERE rather than at each call site so the page has one
          reveal behaviour instead of six, and so a section added later gets
          it without anybody remembering to. `Reveal` degrades to plain
          visible content with no JS, under reduced motion, and for anything
          already on screen at mount — see the note on the component. */}
      <Container>
        <Reveal className="flex flex-col gap-5 sm:gap-8">{children}</Reveal>
      </Container>
    </section>
  );
}

/**
 * A framed surface for content that should read as one grouped block rather
 * than as loose items on the page background (the trust strip, the trending
 * strip). Same radius and elevation every time it's used.
 */
export function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-surface p-card shadow-sm sm:p-card-lg lg:p-8',
        className,
      )}
    >
      {children}
    </div>
  );
}
