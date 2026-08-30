import * as React from 'react';
import { Container } from '@/components/shell/container';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { FavouriteButton } from '@/components/discovery/favourite-button';
import { BookingBar } from '@/components/event/booking-bar';
import { Countdown } from '@/components/event/countdown';
import { HeroGallery, type GalleryImage } from '@/components/event/hero-gallery';
import { AddToCalendar } from '@/components/event/add-to-calendar';
import { ShareMenu } from '@/components/event/share-menu';
import {
  AccessibilityNotes,
  EventFaqs,
  Faqs,
  OrganizerCard,
  EventVideo,
  OrganizerPolicies,
  Policies,
  QuickFacts,
  RunningOrder,
  SectionHeading,
  VenueCard,
} from '@/components/event/sections';
import { BookingCta } from '@/components/event/booking-cta';
import { EventDisclosures, type Disclosure } from '@/components/event/disclosures';
import { EventReviews } from '@/components/reviews/event-reviews';
import { Building2, CalendarClock, HelpCircle, Info, MapPin, ScrollText } from 'lucide-react';
import type { EventContent } from '@/lib/api/event-content';
import type { EventDetail, TicketTier } from '@/lib/api/types';
import { ClayIcon } from '@/components/illustrations/clay';
import { inferCategory } from '@/lib/discovery/categories';
import { formatEventDateLong, formatEventTime } from '@/lib/discovery/format';
import { availabilityLabel, isUrgent, summariseTiers } from '@/lib/discovery/tiers';
import { cn } from '@/lib/utils/cn';
import { eventPath } from '@/lib/events/ref';
import { browseHref } from '@/lib/discovery/filters';

/**
 * The event page, as a component — so the Studio's preview IS the event page.
 *
 * ── WHY THIS WAS EXTRACTED ────────────────────────────────────────────────
 *
 * The organizer's preview used to be a hand-drawn approximation: a small card,
 * four stat tiles and a mock search snippet. It answered "roughly what will
 * this look like" and nothing more, and every change to the real page made it
 * a little less true — its search snippet had already drifted from what
 * `generateMetadata` actually emits.
 *
 * A preview whose only job is to show somebody the page they are about to
 * publish should BE that page. So the whole body lives here, and both callers
 * render the same component with the same props:
 *
 *   app/(site)/events/[id]/page.tsx   the live page, from the API
 *   components/organizer/wizard/…     the preview, from the local draft
 *
 * There is no second layout to keep in sync, and no way for the preview to
 * describe a page that will not appear. This is the same rule as the one
 * auth panel: two copies of a surface is how the two drift.
 *
 * ── WHAT `preview` CHANGES, AND WHAT IT DELIBERATELY DOES NOT ─────────────
 *
 * ONLY the things that cannot work for a draft:
 *
 *   - the ticket panel stops polling live availability and its buy button goes
 *     inert (there is nothing to buy yet, and a draft's tiers may not exist on
 *     the server to be polled),
 *   - save/share/calendar are dropped: each needs a public URL or an event id,
 *     and offering "share" for an unpublished draft is offering a dead link,
 *   - the mobile booking bar is dropped for the same reason as the buy button.
 *
 * Everything else is identical — the gallery, the urgency and sold-out
 * badges, the countdown, the quick facts, the running order, the organiser and
 * venue cards, the FAQs, the policies. If it is wrong in the preview, it is
 * wrong on the page.
 *
 * `related` is a SLOT rather than a prop this component fetches: on the live
 * page it is an async server component streamed behind its own Suspense
 * boundary, and the preview has no business making that request at all.
 */
export function EventPageBody({
  event,
  tiers,
  content,
  preview = false,
  related = null,
}: {
  event: EventDetail;
  tiers: TicketTier[];
  content: EventContent;
  preview?: boolean;
  related?: React.ReactNode;
}) {
  const category = inferCategory(event);
  const summary = summariseTiers(tiers);
  const availability = availabilityLabel(summary.state);

  /**
   * What the gallery shows, in the order it shows it.
   *
   * The organiser's HERO image leads if they set one; otherwise `poster_url`,
   * which is the column every card and link preview already uses — so the page
   * opens on the same picture the visitor clicked. Gallery images follow in
   * their stored `position`. Thumbnail and mobile crops are deliberately
   * excluded: they are alternate renditions of an image already here, not more
   * photographs, and padding a filmstrip with duplicates is exactly the
   * "repeat the same picture" failure this component was written to avoid.
   */
  const hero = content.media.find((item) => item.kind === 'hero');
  // Capped at one by the server, so `find` is the whole story rather than a
  // first-of-many. It renders as its own section BELOW the description, not in
  // the filmstrip: a still that plays when you click it is not a photograph,
  // and mixing the two makes the gallery's arrow keys mean two things.
  const video = content.media.find((item) => item.kind === 'video');
  // ── THE HERO IS THE ARTWORK; THE GALLERY IS ITS OWN SECTION ─────────────
  //
  // These used to be one list: the organiser's gallery photographs were
  // appended to the hero's filmstrip, so the top of the page carried every
  // image the event had and there was no gallery section at all.
  //
  // They answer different questions. The hero is "what is this" — one picture,
  // above the fold, the LCP element. The gallery is "show me more", which
  // somebody asks AFTER deciding to keep reading. Splitting them lets the hero
  // stay a single decisive image and gives the photographs a section that is
  // absent, not empty, when there are none.
  const heroImages: GalleryImage[] = hero
    ? [{ url: hero.url, alt: hero.alt_text || event.title }]
    : event.poster_url
      ? [{ url: event.poster_url, alt: event.title }]
      : [];
  const galleryImages: GalleryImage[] = content.media
    .filter((item) => item.kind === 'gallery')
    .map((item) => ({ url: item.url, alt: item.alt_text || event.title }));

  // Two groups, one builder. `RAIL_KEYS` is the only place the split is
  // stated, so a new disclosure lands in the body unless it is named here —
  // which is the safe default: the rail is beside the money and has room for
  // two rows, not six.
  const allDisclosures = buildDisclosures(event, content);
  const bodyItems = allDisclosures.filter((item) => !RAIL_KEYS.includes(item.key));
  const railItems = RAIL_KEYS.map((key) => allDisclosures.find((item) => item.key === key))
    .filter((item): item is Disclosure => Boolean(item))
    // A rail row is a ROW, never a preview: the rail is 22rem of column beside
    // the price, and a four-fact grid or a running order in there is the
    // sidebar-picker mistake in a different costume. The summary the preview
    // would have shown moves onto the row's own value line.
    .map((item) => ({
      ...item,
      preview: undefined,
      value: item.key === 'schedule' ? scheduleSummary(content) : item.value,
    }));

  const crumbs = [
    { label: 'Home', href: '/' },
    { label: event.city, href: browseHref({ city: event.city }) },
    ...(category ? [{ label: category.label, href: `/categories/${category.slug}` }] : []),
    { label: event.title },
  ];

  return (
    <>
      <Container className="flex flex-col gap-8 py-6 lg:gap-10 lg:py-8">
        <Breadcrumb items={crumbs} />

        {/*
          ONE ticket panel, placed by the grid rather than duplicated.
          An earlier version rendered it twice — once inline for mobile, once in
          a `hidden lg:block` rail — which put two `id="tickets"` anchors and two
          "Tickets" regions in every document, and gave screen readers the whole
          panel twice at every width. Explicit row/column placement moves the one
          instance instead: source order (hero, panel, everything else) is the
          mobile reading order, and at `lg` the panel jumps to column two, row
          one, where it sticks.
        */}
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
          <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-1">
            {/* ── NAME IT, DATE IT, THEN SHOW IT ────────────────────────────
                The reference design puts the title and the date ABOVE the
                artwork, and this now matches it.

                The previous order was picture-first, on the argument that a
                large clear image is what a visitor processes first. That is
                true of a poster somebody is BROWSING. It is the wrong way
                round for a page they have already chosen to open: they arrived
                from a card that showed them the artwork, so leading with it
                again spends the first screen re-showing what they just
                clicked, and pushes the one fact that decides everything — the
                DATE — below it.

                The constraint that produced the old order still holds and is
                still handled: the frame is a fixed 16:9 bounded by the COLUMN,
                so a landscape image cannot resolve wider than its column and
                run over the title, which is the bug that caused the last two
                rearrangements. */}
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                {category ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface py-1 pl-1.5 pr-3 text-caption text-muted-foreground">
                    <ClayIcon slug={category.slug} className="size-5" />
                    {category.label}
                  </span>
                ) : null}
                {availability ? (
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-3 py-1 text-caption',
                      summary.state.kind === 'sold_out'
                        ? 'bg-destructive-subtle text-destructive-subtle-foreground'
                        : isUrgent(summary.state)
                          ? 'bg-warning-subtle text-warning-subtle-foreground'
                          : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {availability}
                  </span>
                ) : null}
              </div>

              <h1 className="text-h2 md:text-h1">{event.title}</h1>

              {/* WHEN, then WHERE — two lines, not one run-on. The date is the
                  single fact that decides whether the rest of the page is worth
                  reading, and it is one of the two places the target language
                  still sanctions the violet accent. */}
              <div className="flex flex-col gap-1">
                <p className="text-body-lg font-semibold text-primary">
                  {formatEventDateLong(event.starts_at)} · {formatEventTime(event.starts_at)}
                </p>
                <p className="text-body text-muted-foreground">
                  {event.venue}, {event.city}
                </p>
              </div>
            </div>

            <HeroGallery images={heroImages} categorySlug={category?.slug} />

            <div className="flex min-w-0 flex-col gap-4">
              {/* Save, share and add-to-calendar all need a PUBLISHED event —
                  a public URL to share, an id to save against. In a preview
                  they would each be a control that cannot do its one job. */}
              {preview ? null : (
                <div className="flex flex-wrap items-center gap-2">
                  <ShareMenu title={event.title} path={eventPath(event)} />
                  {/* Beside share and save: all three are "keep this for later"
                      actions, and separating them would make the calendar the
                      only one a visitor has to hunt for. */}
                  <AddToCalendar event={event} />
                  {/* Off the poster and into the action row, so it drops
                      `.glass-media`'s photo scrim for the same hairline pill the
                      two beside it wear. `size-11` is the 44px touch floor. */}
                  <FavouriteButton
                    eventId={event.id}
                    title={event.title}
                    className="size-11 border-input bg-surface text-muted-foreground hover:bg-muted hover:text-foreground"
                  />
                </div>
              )}
            </div>
            <Countdown startsAt={event.starts_at} />
          </div>

          {/* `lg:top-sticky-top-lg` is the header's own height plus a rung of
              breathing room, derived rather than the hard-coded 80px it was —
              which had already drifted from a 72px header. */}
          {/* ── THE RAIL CARRIES THE DECISION, AND THE TWO FACTS BESIDE IT ──
              Price and CTA first, then WHERE and WHEN as compact rows — which
              is where the reference design puts them, and it is right: the
              venue and the gate time are the two things somebody checks
              immediately after the price, and sending them down the page to
              find either is what made this page a scroll. Everything else
              (organiser, FAQs, policies) stays in the body. */}
          <div className="flex flex-col gap-3 lg:sticky lg:top-sticky-top-lg lg:col-start-2 lg:row-start-1 lg:pt-4">
            <BookingCta
              eventId={event.id}
              tiers={tiers}
              cancelled={event.status === 'cancelled'}
              preview={preview}
            />
            {railItems.length ? <EventDisclosures items={railItems} /> : null}
          </div>

          <div className="flex min-w-0 flex-col gap-10 lg:col-start-1 lg:row-start-2">
            {/* ABSENT, not empty. An event with no gallery gets no heading —
                a "Gallery" over nothing is a promise the page cannot keep.
                `priority={false}`: the hero above is the LCP element, and
                marking a second set of images high-priority competes with it
                for the same bandwidth. */}
            {galleryImages.length ? (
              <section className="flex flex-col gap-4">
                <SectionHeading>Gallery</SectionHeading>
                <HeroGallery images={galleryImages} priority={false} hideMainImage />
              </section>
            ) : null}

            {video ? (
              <section className="flex flex-col gap-4">
                <SectionHeading>Watch</SectionHeading>
                <EventVideo video={video} />
              </section>
            ) : null}

            {event.description ? (
              <section className="flex flex-col gap-4">
                <SectionHeading>About this event</SectionHeading>
                <p className="max-w-2xl whitespace-pre-line text-body-lg text-muted-foreground">
                  {event.description}
                </p>
              </section>
            ) : null}

            {/* ── EVERYTHING ELSE, ONE PRESS AWAY ───────────────────────────
                These six used to be six full-weight sections stacked here,
                and with the four above them the page ran to ten. All of it is
                information somebody genuinely needs — the age limit, the
                refund rule, when the gates open — but not all of it at the
                same moment, and rendering it all at once made the page a
                document to scroll rather than a decision to make.

                Each row carries a summary that answers the common case
                outright, so the press is only for the rest. Rows that have
                nothing behind them are ABSENT, not empty: `buildDisclosures`
                omits the running order when the organiser supplied none, and
                omits accessibility rather than opening a sheet that says
                nothing — silence is honest where a placeholder is a claim. */}
            <section className="flex flex-col gap-4">
              <SectionHeading>Event information</SectionHeading>
              <EventDisclosures items={bodyItems} />
            </section>

            {/* Reviews sit AFTER the practical detail and BEFORE the rules:
                somebody deciding has already read what the event is, and other
                people's experience is the last input before the terms. In a
                preview there is nothing to show — a draft has no attendees. */}
            {preview ? null : (
              <section className="flex flex-col gap-4">
                <SectionHeading>Reviews</SectionHeading>
                <EventReviews eventId={event.id} />
              </section>
            )}
          </div>
        </div>

        {related}
      </Container>

      {/* Mobile only, and only once the panel above has scrolled away. */}
      {/* A cancelled event gets no sticky CTA. The bar's whole job is to keep
          a price and a Book button on screen; on an event that is not
          happening, that is a button pointing at a checkout nobody can
          complete — and the panel above already says where the money is. */}
      {preview || event.status === 'cancelled' ? null : (
        <BookingBar eventId={event.id} initialTiers={tiers} />
      )}
    </>
  );
}

/**
 * Which disclosures sit in the booking rail, IN THE ORDER THEY APPEAR THERE.
 *
 * Where, then when — the two things somebody checks straight after the price.
 * The array is the ordering too, so this is the single place the rail's shape
 * is stated.
 */
const RAIL_KEYS = ['venue', 'schedule'];

/* -------------------------------------------------------------------------- */
/* Progressive disclosure                                                     */
/* -------------------------------------------------------------------------- */

/** "Gates open at 1:00 PM" — the one schedule fact worth a rail row. */
function scheduleSummary(content: EventContent): string | undefined {
  const first = content.timeline[0];
  if (!first) return undefined;
  // The time is omitted rather than guessed: an entry may carry a label and
  // no `starts_at`, and "Gates open at Invalid Date" is worse than "Gates open".
  return first.starts_at ? `${first.label} at ${formatEventTime(first.starts_at)}` : first.label;
}

/** A compact "2h 30m" for a ROW. The sheet shows the precise value. */
function briefDuration(event: EventDetail): string | null {
  const minutes =
    event.duration_minutes && event.duration_minutes > 0
      ? event.duration_minutes
      : event.ends_at != null
        ? Math.round((Date.parse(event.ends_at) - Date.parse(event.starts_at)) / 60_000)
        : null;
  if (minutes == null || minutes <= 0 || !Number.isFinite(minutes)) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours}h ${rest}m`;
  if (hours) return `${hours}h`;
  return `${rest}m`;
}

/**
 * The rows, in the order somebody deciding actually needs them.
 *
 * Practicalities before rules: "what time do the gates open" and "where is it"
 * are questions asked while deciding, and the refund policy is one asked after
 * deciding. The organiser sits between the two because it is both — who is
 * running this is a trust signal and a route to their other events.
 *
 * A row appears ONLY when there is something behind it. An empty sheet is
 * worse than an absent row: the reader spent a press to learn nothing, and on
 * accessibility specifically a "no information" panel reads as a claim that
 * the venue has no provision, which is not what an empty column means.
 */
function buildDisclosures(event: EventDetail, content: EventContent): Disclosure[] {
  const items: Disclosure[] = [];

  const facts = [briefDuration(event), event.language?.trim(), event.age_restriction?.trim()]
    .filter(Boolean)
    .join(' · ');
  const hasNotes = Boolean(event.accessibility_notes?.trim());

  items.push({
    key: 'know',
    icon: <Info />,
    label: 'Things to know',
    // Falls back to naming what IS in the sheet rather than to a generic
    // "details" — the fact grid always carries the date, venue and organiser.
    value: facts || 'Date, venue, organiser and more',
    // Two columns of facts plus free prose needs the wider sheet.
    size: 'lg',
    // The first four answer the question outright for most visitors — the
    // date, how long it runs, where, and who. Hiding those behind a press to
    // save four lines is disclosure for its own sake.
    preview: <QuickFacts event={event} limit={4} />,
    content: (
      <div className="flex flex-col gap-6">
        <QuickFacts event={event} />
        {hasNotes ? (
          <div className="flex flex-col gap-3">
            {/* An `h3`, not `SectionHeading`. Radix renders the sheet's own
                title as an `h2`, so a subsection inside it that ALSO rendered
                an `h2` would sit at the same level as the thing it belongs
                to — the outline a screen-reader user navigates by would say
                these are two peers rather than a heading and its part. */}
            <h3 className="text-h4">Accessibility</h3>
            <AccessibilityNotes notes={event.accessibility_notes} />
          </div>
        ) : null}
      </div>
    ),
  });

  if (content.timeline.length) {
    const first = content.timeline[0];
    const rest = content.timeline.length - 1;
    items.push({
      key: 'schedule',
      icon: <CalendarClock />,
      label: 'Schedule and timeline',
      value: rest > 0 ? `${first.label} · ${rest} more` : first.label,
      description: formatEventDateLong(event.starts_at),
      size: 'lg',
      content: <RunningOrder entries={content.timeline} />,
      // "Gates open at 1:00 PM" is the single fact somebody scans this section
      // for; the rest of the running order is for the day itself. The time is
      // omitted rather than guessed when the organiser left it out — a
      // timeline entry may carry a label and no `starts_at`.
      preview: (
        <p className="text-body-lg font-semibold text-foreground">
          {first.starts_at ? `${first.label} at ${formatEventTime(first.starts_at)}` : first.label}
        </p>
      ),
      previewCta: 'View full schedule & timeline',
    });
  }

  items.push({
    key: 'venue',
    icon: <MapPin />,
    label: 'Venue details',
    value: `${event.venue}, ${event.city}`,
    size: 'lg',
    content: <VenueCard event={event} />,
  });

  items.push({
    key: 'organiser',
    icon: <Building2 />,
    label: 'Organiser',
    value: event.organization_name,
    content: <OrganizerCard event={event} />,
  });

  items.push({
    key: 'faqs',
    icon: <HelpCircle />,
    label: 'Frequently asked',
    // Counts the organiser's OWN questions only. The platform set below them is
    // identical on every event, so folding it into the count would make every
    // event claim the same baseline number of answers.
    value: content.faqs.length
      ? `${content.faqs.length} question${content.faqs.length === 1 ? '' : 's'} from the organiser`
      : 'How tickets, entry and refunds work',
    size: 'lg',
    content: (
      <div className="flex flex-col gap-6">
        {/* The organiser's own questions first: "is there parking at THIS
            venue" beats "how does a QR ticket work" for someone deciding
            tonight. */}
        <EventFaqs faqs={content.faqs} />
        <Faqs />
      </div>
    ),
  });

  items.push({
    key: 'terms',
    icon: <ScrollText />,
    label: 'Terms and policies',
    value: 'Refunds, entry and ID',
    size: 'lg',
    content: (
      <div className="flex flex-col gap-6">
        {/* The organiser's rules FIRST: "carry a photo ID" is the one that
            stops somebody at the gate, and "no card data is stored" is
            reassurance. A reader gives this about four seconds. */}
        <OrganizerPolicies policies={event.policies} />
        <Policies />
      </div>
    ),
  });

  return items;
}
