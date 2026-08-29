import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { SpotHireABand } from '@/components/illustrations/spots';
import { Cta } from '@/components/discovery/cta';
import { Reveal } from '@/components/discovery/reveal';
import { Container } from '@/components/shell/container';

/**
 * Hire a Band, on the landing page.
 *
 * ── IT IS A DIFFERENT PRODUCT, SO IT LOOKS DIFFERENT ──────────────────────
 *
 * Everything above it on the page sells a TICKET to somebody else's event.
 * This sells a service for the visitor's own. If it were another rail of the
 * same cards in the same rhythm, people would scroll past it as more of the
 * same — so it sits on a tinted band, leads with the eight ways in rather than
 * with inventory, and carries one primary call to action instead of a "view
 * all" link.
 *
 * ── THE TYPE TILES ARE THE ENTRY POINT, NOT A ROSTER ──────────────────────
 *
 * Somebody planning a wedding knows they want a band before they know WHICH
 * band, so the eight ways in are the whole section. A "Featured acts" scroller
 * used to sit below them and was removed: on the landing page it answered a
 * question nobody had got to yet, and it put the visitor in front of one
 * specific act — with a price — before they had said anything about their own
 * event. The job here is to get somebody to the brief or to the index; picking
 * an act is `/hire`'s job, with filters and the full roster behind it.
 *
 * Its removal also takes a server request off the front page's critical path,
 * which is the section's second-order win.
 *
 * ── IT USED TO BE A FULL SCREEN ON A PHONE ────────────────────────────────
 *
 * A 40px heading, a `text-body-lg` paragraph and eight stacked icon-above-label
 * cards came to roughly 670px on a 360px viewport — one section filling an
 * entire scroll, on a page whose job is to keep moving. Three changes, none of
 * which drop anything:
 *
 *  1. **The type is a ROW under `sm`** — artwork left, label right, on the
 *     44px control height. Eight of them are four short rows instead of four
 *     tall cards, and every one of the eight stays visible rather than being
 *     hidden behind a horizontal scroller.
 *  2. **The heading steps down two rungs** (`text-h3` → `sm:text-h2` →
 *     `lg:text-h1`) and the blurb with it. `text-h1` is 40/48 — a size chosen
 *     for a 1440px canvas, not for a phone.
 *  3. **The illustration sits BESIDE the copy on a phone**, not above it, so
 *     it costs one line of height rather than a whole band of it.
 *
 * A server component: no state of its own. `PerformerScene` and the spot are
 * client modules for their `useId` gradients — the same, already-paid cost the
 * category tiles carry.
 */



export function HireABandSection() {
  return (
    // The tinted band. Alternating a subtle tint against the page's surface is
    // what separates sections without drawing a line across the page — and it
    // is the one place on the landing page a second background appears.
    <section className="border-y border-border bg-muted/40 py-section lg:py-section-lg">
      {/* `Container`, not a hand-rolled wrapper. This was
          `max-w-content px-4 sm:px-6 lg:px-8` — and `max-w-content` is not a
          token, so it resolved to nothing: the section had NO width cap and
          its own gutters, which put its heading 72px to the left of every
          other heading on the page at 1440. The tint made a full-bleed band
          look deliberate, so the misalignment read as a rendering glitch
          rather than as the missing class it was. Same for the padding: the
          band keeps its own generous rhythm, but from the page's tokens. */}
      <Container>
        <Reveal>
          <div className="flex items-center gap-4 sm:gap-6 lg:gap-12">
            <div className="flex min-w-0 flex-1 flex-col gap-2 sm:gap-3 lg:max-w-2xl">
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-caption text-muted-foreground">
                <Sparkles className="size-3.5" aria-hidden />
                New on Curatix
              </span>
              <h2 className="text-h3 font-extrabold tracking-tight sm:text-h2 lg:text-h1">
                Hire a band, DJ or performer for your own event
              </h2>
            </div>

            {/* One instance, sized responsively, rather than a mobile copy and
                a desktop copy — two SVGs is two things to keep in step. */}
            <SpotHireABand className="h-20 w-auto shrink-0 sm:h-28 lg:h-44" />
          </div>
        </Reveal>

        <Reveal>
          <div className="mt-6 flex flex-wrap items-center gap-2 sm:mt-10 sm:gap-3">
            {/* ONE call to action, because there is one thing to do.
                "Browse performers" sat beside this and pointed at a
                marketplace that no longer exists — a second button whose only
                job was to go somewhere the first one already goes. Two CTAs
                where there is one action is how a section stops having a
                primary one at all. */}
            <Cta href="/hire">Tell us what you need</Cta>
            {/* Both halves are checkable. "Quotes usually arrive within a day
                or two" was here once — a RESPONSE TIME nothing measures — and
                "one brief reaches every act that fits it" replaced it and then
                became untrue in its turn when the supply side went. This is
                the mechanic as it actually works. */}
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
