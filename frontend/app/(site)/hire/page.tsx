import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { BriefForm } from '@/components/hire/brief-form';
import { PerformerCard } from '@/components/hire/performer-card';
import { SpotHireABand } from '@/components/illustrations/spots';
import { Container } from '@/components/shell/container';
import { fetchPerformersSafe } from '@/lib/api/performers';
import { cn } from '@/lib/utils/cn';
import { pageMetadata } from '@/lib/seo/metadata';

/**
 * Hire an act.
 *
 * ── THE SAME LANGUAGE AS THE FRONT PAGE, FOR THE OTHER PRODUCT ────────────
 *
 * Statement band, then a chip row, then a grid of portraits, then the thing
 * you came to do. That is the home page's shape — recommend, list, act — and
 * using it here is what makes the two products read as one platform rather
 * than as a ticketing site with a form bolted to the side.
 *
 * The chips are `?type=` links this page already accepts, so they are
 * shareable, back-buttonable URLs rather than client-side toggles, exactly as
 * the events chips are.
 *
 * ── THE FORM IS THE PAGE, THE GRID IS THE PROOF ───────────────────────────
 *
 * This page used to be ONLY the enquiry form, on the correct reasoning that a
 * browse page rendering an empty grid is a shop with nothing in it and no sign
 * saying so. That reasoning still holds, and it is why the grid is
 * CONDITIONAL: zero published acts renders nothing at all, exactly as before.
 *
 * What changed is the order. Sending an enquiry is the action that works for
 * every visitor whether or not anything is listed, so it stays above the fold;
 * the acts sit under it as evidence that somebody is on the other end, and as
 * the only public inbound link to profiles that are otherwise indexable and
 * unreachable.
 *
 * ── AND IT IS STILL INDEXED ───────────────────────────────────────────────
 *
 * "Hire a band in Mumbai" is a real search somebody makes, and this is a real
 * answer to it. The metadata describes what the page DOES rather than
 * advertising a catalogue that may not be there.
 */
export const metadata: Metadata = {
  ...pageMetadata(
    'Hire a band, DJ or performer',
    'Tell us what you need for your wedding, party or corporate event, and our team will get ' +
      'back to you with options and prices.',
  ),
  alternates: { canonical: '/hire' },
};

/**
 * ISR on the same clock as the backend's own `s-maxage=60` for the marketplace
 * reads, so the page, the Next data cache and the edge age together instead of
 * on three different timers.
 */
export const revalidate = 60;

/** Enough to prove the marketplace exists and give a crawler real links,
 *  without turning an enquiry page into a browse page. */
const MAX_ACTS_SHOWN = 8;

/** The eight the brief names. `other` is a real type but a poor entry point. */

const CHIP_CLASS =
  'inline-flex h-control shrink-0 items-center whitespace-nowrap rounded-full border border-border bg-surface px-4 text-label text-foreground transition-colors duration-fast hover:border-muted-foreground/40 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

export default async function HirePage() {
  // Never throws: a listing that cannot load must not take the form down.
  // Sliced rather than page-sized, because the browse endpoint is cursor-
  // paginated and takes no size parameter — its first page is already small.
  const performers = (await fetchPerformersSafe()).slice(0, MAX_ACTS_SHOWN);

  return (
    <>
      {/* ── THE STATEMENT BAND ─────────────────────────────────────────── */}
      <section className="border-b border-border bg-muted/40">
        <Container className="flex items-center gap-8 py-8 sm:py-12 lg:gap-12 lg:py-16">
          <div className="flex min-w-0 flex-1 flex-col gap-3 sm:gap-4">
            {/* ── THE TYPE LADDER IS A MOBILE FIX, NOT A PREFERENCE ───────
                At `text-h2` and extrabold this headline wrapped to THREE lines
                on a 390px phone, and the 18px paragraph under it to five — so
                the entire first screen, and part of the second, was copy before
                anything you could act on. On a page whose whole job is a form,
                that is the copy talking the visitor out of filling it in. It
                steps down two rungs on a phone and back up on a desktop, where
                the width earns the size. */}
            <h1 className="max-w-3xl text-h3 font-extrabold leading-[1.1] tracking-tight text-foreground sm:text-h2 lg:text-display">
              Hire a band, DJ or performer for your own event
            </h1>
          </div>

          {/* ── THE OTHER HALF OF A 1440px BAND ─────────────────────────
              Text only, this band left roughly half the width empty at every
              desktop size — which on an image-forward layout reads as a
              placeholder somebody forgot to fill. The artwork is the one the
              home page's Hire band already uses, so the two entry points to
              this product look like the same product; it is decorative and
              carries no information the copy does not, which is why it is
              `aria-hidden` and why it is the first thing to go on a phone. */}
          <SpotHireABand className="hidden h-44 w-auto shrink-0 lg:block xl:h-52" aria-hidden />
        </Container>
      </section>

      {/* ── THE ENQUIRY ────────────────────────────────────────────────── */}
      <Container className="py-8 sm:py-10">
        <BriefForm />
      </Container>

      {/* ── THE ACTS, WHEN THERE ARE ANY ───────────────────────────────── */}
      {performers.length ? (
        <section aria-labelledby="acts-heading" className="border-t border-border">
          <Container className="flex flex-col gap-5 py-8 sm:gap-6 sm:py-10">
            <div className="flex flex-col gap-2">
              <h2
                id="acts-heading"
                className="text-h3 font-extrabold tracking-tight text-foreground sm:text-h2"
              >
                Acts on Curatix
              </h2>
              <p className="max-w-2xl text-body text-muted-foreground">
                Every act here has been through the same verification as the organisations that run
                events on the platform.
              </p>
            </div>

            <ul className="grid grid-cols-2 gap-x-4 gap-y-7 sm:gap-x-5 lg:grid-cols-4">
              {performers.map((performer, index) => (
                <li key={performer.id} className="flex">
                  {/* The first row is above the fold on a phone. */}
                  <PerformerCard performer={performer} priority={index < 2} />
                </li>
              ))}
            </ul>

            <Link
              href="/hire/requests"
              className={cn(CHIP_CLASS, 'group w-fit gap-2 self-center px-pill')}
            >
              Your enquiries
              <ArrowRight
                className="size-4 transition-transform duration-fast group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                aria-hidden
              />
            </Link>
          </Container>
        </section>
      ) : null}
    </>
  );
}
