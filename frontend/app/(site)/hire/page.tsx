import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { BriefForm } from '@/components/hire/brief-form';
import { PerformerCard } from '@/components/hire/performer-card';
import { Container } from '@/components/shell/container';
import { PERFORMER_TYPE_LABELS, type PerformerType } from '@/lib/api/enquiries';
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
const ENTRY_TYPES: PerformerType[] = [
  'band',
  'dj',
  'singer',
  'instrumentalist',
  'comedian',
  'anchor',
  'dance_crew',
  'magician',
];

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
        <Container className="flex flex-col gap-4 py-10 sm:py-14 lg:py-16">
          <h1 className="max-w-3xl text-h2 font-extrabold leading-[1.1] tracking-tight text-foreground lg:text-display">
            Hire a band, DJ or performer for your own event
          </h1>
          <p className="max-w-2xl text-body-lg text-muted-foreground">
            Tell us the date, the city and roughly what you have in mind. Our team comes back to you
            with options and prices — no account needed.
          </p>

          {/* The type chips. `?type=` is a param this route already reads, so
              each one is a real URL rather than a client-side toggle. */}
          <div className="-mx-4 mt-1 flex gap-2.5 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
            {ENTRY_TYPES.map((type) => (
              <Link key={type} href={`/hire?type=${type}`} className={CHIP_CLASS}>
                {PERFORMER_TYPE_LABELS[type]}
              </Link>
            ))}
          </div>
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
