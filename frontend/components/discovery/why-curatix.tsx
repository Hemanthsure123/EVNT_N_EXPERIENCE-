import * as React from 'react';
import { BadgeCheck, QrCode, RotateCcw, ShieldCheck } from 'lucide-react';
import { Container } from '@/components/shell/container';
import { cn } from '@/lib/utils/cn';
import { Reveal } from './reveal';
import { SectionHeader } from './section';

/**
 * Why Curatix — four promises, each one a thing the BACKEND actually does.
 *
 * Signature-verified webhooks, signed QR tickets, automatic refunds when a
 * ticket can't be issued, and payouts released only after the event are all
 * implemented server-side. This is a summary of the system, not marketing copy,
 * which is the only reason it earns space on a page whose job is to get someone
 * to an event.
 */
const PROMISES = [
  {
    icon: ShieldCheck,
    title: 'Secure payments',
  },
  {
    icon: BadgeCheck,
    title: 'Verified organizers',
  },
  {
    icon: QrCode,
    title: 'Instant tickets',
  },
  {
    icon: RotateCcw,
    title: 'Easy refunds',
  },
];

/**
 * The one SUNKEN band on the page.
 *
 * With a pure-white canvas and white cards, a section can no longer separate
 * itself by being lighter than the page — there is nowhere lighter to go. The
 * one value step available runs downward, and spending it here (a strip of
 * white cards on a very light warm grey) is what gives the front page a change
 * of surface between the event rails and the footer without introducing a
 * second colour. Everything above it stays on the canvas, so this reads as one
 * deliberate band rather than as stripes.
 *
 * ── TWO UP ON A PHONE, AND THE MARK MOVES BESIDE THE TITLE ────────────────
 *
 * `grid-cols-1` below `sm` gave four ~212px cards in a column — ~896px, a
 * whole phone screen of reassurance sitting between the reader and the footer.
 * Two up halves the rows, and pulling the 48px mark onto the same line as the
 * title (rather than stacking above it) takes another ~44px off each card:
 * ~168px each, ~348px for the band. The mark returns to its own line at `sm`,
 * where the card is wide enough for the stack to read as composed.
 *
 * The BODY COPY is untouched. Every sentence here is a claim about something
 * the backend actually does, and shortening one to save a wrapped line is how
 * a true statement quietly becomes an approximate one.
 */
export function WhyCuratix() {
  return (
    <section className="bg-sunken py-section lg:py-section-lg">
      <Container className="flex flex-col gap-5 sm:gap-8">
        <Reveal>
          <SectionHeader title="Why Curatix" subtitle="What you get on every booking" />
        </Reveal>

        <ul className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
          {PROMISES.map((promise, index) => (
            <li key={promise.title}>
              <Reveal delayMs={index * 60}>
                <div
                  className={cn(
                    // `border-border` is not optional on a white card: in light
                    // theme the surface IS the canvas colour, so the hairline
                    // plus the shadow is the entire reason the card is visible.
                    'group/promise flex h-full flex-col gap-2 rounded-xl border border-border bg-surface p-card shadow-sm',
                    'sm:gap-4 sm:p-card-lg',
                    'transition duration-base ease-spring hover:-translate-y-1 hover:shadow-lg',
                    'motion-reduce:hover:translate-y-0',
                  )}
                >
                  <span className="flex items-center gap-2.5 sm:flex-col sm:items-start sm:gap-4">
                    <span
                      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-nav-active text-nav-active-foreground sm:size-12"
                      aria-hidden
                    >
                      <promise.icon className="size-5 sm:size-6" />
                    </span>
                    <span className="text-body-sm font-semibold leading-tight text-foreground sm:text-body-lg sm:leading-normal">
                      {promise.title}
                    </span>
                  </span>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
