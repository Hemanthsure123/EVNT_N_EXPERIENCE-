import * as React from 'react';
import { Suspense } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Container } from '@/components/shell/container';
import { HeroSearchTrigger } from '@/components/search/search-trigger';
import { greetingFor } from '@/lib/discovery/date-windows';
import { browseHref } from '@/lib/discovery/filters';
import { type Homepage, fetchHomepageSafe } from '@/lib/api/cms';
import type { PopularSearch } from '@/lib/search/popular-searches';
import { HeroFeatured, HeroFeaturedSkeleton } from './hero-featured';
import { LocationCard } from './location-card';
import { QuickFilters } from './quick-filters';

/**
 * The landing hero: intent on the left, inventory on the right.
 *
 * The split is the point. A single centred column of copy leaves half a desktop
 * viewport empty and makes the reader scroll before the page shows one real
 * event; pairing the search with a live featured event means the first screen
 * answers both "what is this" and "what's on" at once. That is the whole
 * fifteen-second promise.
 *
 * ── THE HERO IS LIGHT NOW, AND THAT IS THE BIGGEST SINGLE CHANGE ──────────
 *
 * It used to stack five layers over a dark canvas: violet/pink aurora pools, a
 * crowd silhouette in `--overlay`, drifting particles, a vignette and grain —
 * so the first screen of a light-first, image-forward product was a violet
 * aurora with a gradient word in the headline. Three of those layers are gone.
 * What is left is the warm wash (`.hero-atmosphere`, retuned in globals.css to
 * a trace of violet, a butter pool and a neutral settle) and the grain that
 * stops it banding on 8-bit panels. Both still cost no request and no layout,
 * and both still recolour with the theme — dark keeps real colour, because
 * there is nothing else carrying the page there.
 *
 * The crowd and the vignette went because they are drawn in `--overlay`, a warm
 * near-black in BOTH themes: correct over a photograph, dirt on a white page.
 * The headline's gradient word went because the display face at 56/800 with
 * tightened tracking is the brand moment now, and a page whose heading is a
 * gradient has no brand moment left to spend.
 *
 * Nothing here is scroll-revealed. An element that starts at `opacity: 0` can't
 * be the Largest Contentful Paint, so animating the hero would trade a real
 * metric for a flourish.
 */
/**
 * Copy comes from the CMS (`GET /homepage`, server-rendered) when it is
 * available. The literals below are the LAST resort — used only when the CMS
 * request failed, never as a competing source of truth. The real defaults live
 * in a data migration (`cms/0002_seed_defaults`) precisely so an operator can
 * edit them without a deploy.
 */
type HomepageHero = Homepage['hero'];

/**
 * ── WHERE THE SUGGESTIONS COME FROM ───────────────────────────────────────
 *
 * The trending searches are the operator's `cms.PopularSearch` rows, which ride
 * on the same `GET /homepage` payload the page already read. Reading it again
 * here costs NO request: identical URL, identical options, so Next memoises it
 * within the render pass and serves it from the data cache across requests.
 * The alternative — fetching the list from the browser — would put a round trip
 * in front of the LCP element for six strings that are the same for everybody.
 *
 * It never throws (`fetchHomepageSafe`), and an empty list falls through to the
 * bundled one inside `HeroSearchTrigger`, so a CMS outage costs a suggestion,
 * not the hero.
 */
async function heroSuggestions(): Promise<PopularSearch[]> {
  const cms = await fetchHomepageSafe();
  return (cms?.popular_searches ?? []).map((row) => ({
    label: row.label,
    href: browseHref({ q: row.query }),
  }));
}

export async function HomeHero({ hero }: { hero?: HomepageHero }) {
  const greeting = greetingFor();
  const suggestions = await heroSuggestions();

  return (
    <section className="relative isolate overflow-hidden border-b border-border">
      {/* Two layers, both token-built: a warm wash and a fine grain. No image,
          no request, no layout — and nothing drawn in `--overlay`, which is a
          near-black in both themes and would sit on this page as dirt. */}
      <div className="hero-atmosphere absolute inset-0 -z-10" aria-hidden />
      <div className="hero-noise absolute inset-0 -z-10" aria-hidden />

      <Container className="flex flex-col justify-center gap-10 py-12 lg:min-h-[85svh] lg:py-16">
        <div className="grid items-center gap-12 lg:grid-cols-[42fr_58fr] lg:gap-16">
          <div className="flex min-w-0 flex-col gap-8">
            <div className="flex flex-col gap-5">
              <p className="text-label uppercase tracking-wide text-muted-foreground">{greeting}</p>
              <h1 className="max-w-xl text-h1 md:text-display">
                {hero?.headline || 'What do you feel like today?'}
              </h1>
              <p className="max-w-lg text-body-lg text-muted-foreground">
                {hero?.description ||
                  'From electrifying concerts to laughter-filled nights — find something on tonight, or plan the month. Browsing is free and takes no account.'}
              </p>
              {hero?.trust_badges?.length ? (
                <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {hero.trust_badges.map((badge) => (
                    <li
                      key={badge}
                      className="inline-flex items-center gap-1.5 text-caption text-muted-foreground"
                    >
                      <ShieldCheck className="size-3.5 text-success" aria-hidden />
                      {badge}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {/*
              THE TRENDING STRIP IS GONE, AND ITS CONTENT IS IN THE BAR.

              It was four links under the search field repeating four of the six
              already inside the panel — two renderings of one list, on the one
              screen where vertical space is worth the most. The suggestions now
              roll inside the field itself, which is where the person they help
              is already looking, and the trailing pill runs whichever one is
              showing (components/search/rolling-placeholder.tsx).

              What that costs: three of the four crawlable links. They were
              browse URLs that the category tiles, the city strip and the footer
              all still link to, so nothing is orphaned.
            */}
            <div className="flex flex-col gap-5">
              <HeroSearchTrigger terms={suggestions} placeholder={hero?.search_placeholder} />
              <QuickFilters />
            </div>
          </div>

          <div className="min-w-0 lg:w-full">
            <Suspense fallback={<HeroFeaturedSkeleton />}>
              <HeroFeatured />
            </Suspense>
          </div>
        </div>

        {/* Renders nothing once a city is known or the ask was dismissed. */}
        <LocationCard />
      </Container>
    </section>
  );
}
