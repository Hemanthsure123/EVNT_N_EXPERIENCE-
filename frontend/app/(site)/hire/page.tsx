import type { Metadata } from 'next';
import { Container } from '@/components/shell/container';
import { BriefForm } from '@/components/hire/brief-form';
import { PerformerCard } from '@/components/hire/performer-card';
import { fetchPerformersSafe } from '@/lib/api/performers';
import { pageMetadata } from '@/lib/seo/metadata';

/**
 * Hire an act.
 *
 * ── THIS PAGE USED TO BE A MARKETPLACE ────────────────────────────────────
 *
 * It listed performers with photos, prices and filters, and a brief posted
 * here was answered by whichever of them fitted. The platform has no supply
 * side now, so there is nothing to list — and a browse page rendering an empty
 * grid is a shop with nothing in it and no sign saying so.
 *
 * What replaced it is the thing that was always underneath: describe what you
 * need, and a person on our team gets back to you. That is one screen, so this
 * route leads with the form.
 *
 * ── THE ACTS ARE BACK, BUT ONLY WHEN THERE ARE ANY ────────────────────────
 *
 * `/hire/{id}` profile pages are indexable and carry a canonical tag, and
 * NOTHING on the public site linked to them once this page became a form. A
 * page with no inbound link cannot be crawled and cannot be found by a
 * customer either, which makes it not so much unranked as absent.
 *
 * So the acts render again — CONDITIONALLY. Zero published acts renders
 * nothing at all, exactly as this page does today, because the objection above
 * was right: an empty grid is worse than no grid. One or more, and they are
 * shown, below the form rather than above it, because the enquiry is still the
 * path that works for every visitor and browsing is the path that works only
 * while supply exists.
 *
 * That is the same rule the admin console follows — a section nothing backs is
 * ABSENT, not empty.
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

export default async function HirePage() {
  // Never throws: a listing that cannot load must not take the form down.
  // Sliced rather than page-sized, because the browse endpoint is cursor-
  // paginated and takes no size parameter — its first page is already small.
  const performers = (await fetchPerformersSafe()).slice(0, MAX_ACTS_SHOWN);

  return (
    <Container className="flex flex-col gap-block-lg py-8 lg:gap-section lg:py-12">
      <BriefForm />

      {performers.length ? (
        <section className="flex flex-col gap-6 border-t border-border pt-10">
          <div className="flex flex-col gap-2">
            <h2 className="text-h3 text-foreground">Acts on Curatix</h2>
            <p className="max-w-2xl text-body text-muted-foreground">
              Every act here has been through the same verification as the organisations that
              run events on the platform. Send the form above and we will match you, or look
              through them yourself.
            </p>
          </div>
          <ul className="grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-4">
            {performers.map((performer, index) => (
              <li key={performer.id} className="flex">
                {/* The first row is above the fold on a phone. */}
                <PerformerCard performer={performer} priority={index < 2} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Container>
  );
}
