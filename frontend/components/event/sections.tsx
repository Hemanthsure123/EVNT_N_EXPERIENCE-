import * as React from 'react';
import Link from 'next/link';
import {
  Accessibility,
  Building2,
  CalendarDays,
  Clock,
  Info,
  Languages,
  MapPin,
  Navigation,
  QrCode,
  Receipt,
  ShieldCheck,
  Ticket,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';
import type {
  EventFaq,
  EventMedia,
  EventTimelineEntry,
  TimelineKind,
} from '@/lib/api/event-content';
import { VenueMap } from '@/components/maps/venue-map';
import type { EventDetail, EventPolicy } from '@/lib/api/types';
import { inferCategory } from '@/lib/discovery/categories';
import { formatEventDateLong, formatEventTime, machineDate } from '@/lib/discovery/format';
import { cn } from '@/lib/utils/cn';

/**
 * The lower half of the event page — everything after the decision.
 *
 * All Server Components: none of it holds state, so it ships zero client JS and
 * streams with the rest of the document. The two interactive things on this
 * page (tier selection, the lightbox) are separate islands.
 *
 * ── TWO SURFACE RECIPES, APPLIED BY ROLE ──────────────────────────────────
 *
 * On a pure-white canvas nothing separates by value any more, so every block
 * below picks one of exactly two recipes and never invents a third:
 *
 *   A THING            organiser, venue, an FAQ — something with an identity
 *                      and usually an action. `bg-surface` + `border-border`
 *                      + `shadow-sm`: it LIFTS off the page.
 *   A WELL             quick facts, the access note — data belonging to the
 *                      page rather than to an object. `bg-sunken` +
 *                      `border-border`, no shadow: it RECESSES into the page.
 *
 * Padding is `p-card` throughout rather than a per-component p-4/5/6, so the
 * rhythm is a token and not a series of local decisions. Secondary actions are
 * hairline pills at `h-control` (44px); the only filled control on this page is
 * the black "Book tickets" pill in the ticket panel.
 */

/**
 * One rung: `h3` (24px) against the page's `h1` (32/40px) and 16px body. The
 * step is deliberately wide enough to be a ladder and narrow enough that eight
 * of these down a long page do not read as eight separate pages.
 */
export function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-h3">{children}</h2>;
}

/** The secondary-action pill, shared so the three of them cannot drift. */
const ACTION_PILL =
  'inline-flex h-control shrink-0 items-center gap-2 rounded-full border border-input bg-surface px-pill text-label text-foreground transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} minutes`;
  if (rest === 0) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${hours} hr ${rest} min`;
}

/* -------------------------------------------------------------------------- */
/* Quick facts                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The questions worth answering before scrolling: when, how long, where, who,
 * and — when the organiser stated them — language and age policy.
 *
 * EVERY OPTIONAL ROW IS OMITTED WHEN BLANK, never rendered with a dash or a
 * default. `duration_minutes`, `language` and `age_restriction` are blank on a
 * brand-new event, and "All ages" printed on an 18+ event is the kind of
 * invented default that gets someone turned away at the door.
 *
 * Duration prefers the organiser's own `duration_minutes` over the window
 * between `starts_at` and `ends_at`: a two-day festival runs eight hours a
 * night, and the derived figure would say "About 32 hours".
 */
export function QuickFacts({ event }: { event: EventDetail }) {
  const category = inferCategory(event);
  const derivedHours =
    event.ends_at != null
      ? Math.round(((Date.parse(event.ends_at) - Date.parse(event.starts_at)) / 3_600_000) * 10) /
        10
      : null;
  const duration =
    event.duration_minutes && event.duration_minutes > 0
      ? formatMinutes(event.duration_minutes)
      : derivedHours && derivedHours > 0
        ? `About ${derivedHours} hour${derivedHours === 1 ? '' : 's'}`
        : null;

  const facts: { icon: LucideIcon; label: string; value: React.ReactNode }[] = [
    {
      icon: CalendarDays,
      label: 'Date and time',
      value: (
        <time dateTime={machineDate(event.starts_at)}>
          {formatEventDateLong(event.starts_at)} · {formatEventTime(event.starts_at)}
        </time>
      ),
    },
    ...(duration ? [{ icon: Clock, label: 'Runs for', value: duration }] : []),
    { icon: MapPin, label: 'Venue', value: `${event.venue}, ${event.city}` },
    { icon: Building2, label: 'Organiser', value: event.organization_name },
    ...(event.language?.trim()
      ? [{ icon: Languages, label: 'Language', value: event.language }]
      : []),
    ...(event.age_restriction?.trim()
      ? [{ icon: UserCheck, label: 'Age', value: event.age_restriction }]
      : []),
    ...(category ? [{ icon: category.icon, label: 'Category', value: category.label }] : []),
  ];

  return (
    // A <dl> may only directly contain <dt>/<dd> pairs, optionally wrapped one
    // level deep in a <div>. An earlier version nested them two levels down to
    // get the icon beside the text, which axe flags as a serious WCAG 1.3.1
    // failure — the term/description relationship is simply lost. The icon
    // therefore lives INSIDE the <dt>, which is also where it belongs: it
    // labels the fact, it doesn't sit next to it.
    <dl className="grid gap-4 sm:grid-cols-2">
      {facts.map((fact) => (
        // A WELL, not a card: these are the page's own facts, not seven
        // separate objects. Seven lifted white cards on a white page is seven
        // shadows competing with the one panel that should be lifting.
        <div
          key={fact.label}
          className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-sunken p-card"
        >
          <dt className="flex items-center gap-2 text-caption uppercase tracking-wide text-muted-foreground">
            <fact.icon className="size-3.5 shrink-0" aria-hidden />
            {fact.label}
          </dt>
          <dd className="text-body font-medium text-foreground">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* -------------------------------------------------------------------------- */
/* Organiser                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Who is running this.
 *
 * NO "verified organiser" badge. The backend does have an organisation
 * verification flow, but its outcome is not on the event payload — so this page
 * cannot know, and a trust badge that isn't checked against anything is the
 * single worst thing to fake on a ticketing site. What it shows instead is the
 * real name and a link to everything else they run, which is a check the reader
 * can actually make. BACKLOG.md item 15.
 */
export function OrganizerCard({ event }: { event: EventDetail }) {
  const initials = event.organization_name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-card shadow-sm sm:flex-row sm:items-center">
      {/* A warm neutral tint, not the brand gradient. The mark stands for
          SOMEBODY ELSE'S organisation — painting it in our brand colours makes
          a visual claim about them that the page has no grounds for, and the
          quiet palette wants its colour coming from the photograph anyway. */}
      <span
        className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-secondary text-body font-semibold text-secondary-foreground"
        aria-hidden
      >
        {initials}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-caption uppercase tracking-wide text-muted-foreground">Organised by</p>
        <p className="truncate text-body-lg font-semibold text-foreground">
          {event.organization_name}
        </p>
      </div>
      <Link
        href={`/events?q=${encodeURIComponent(event.organization_name)}`}
        className={ACTION_PILL}
      >
        Their other events
      </Link>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Venue                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Where it is, and how to get there.
 *
 * NO EMBEDDED MAP, and not only for the performance reason the brief gives. The
 * backend stores a venue NAME and a city — no coordinates — so any pin this
 * page dropped would be a guess rendered at street precision, which is the most
 * confidently wrong a UI can be. The "Directions" button instead hands the
 * venue and city to Google Maps, which is the search that actually resolves it,
 * and opens in a new tab so the page isn't lost mid-decision.
 *
 * ── A REAL MAP WHEN THE VENUE WAS PINNED, A STYLISED ONE WHEN NOT ────────
 *
 * `latitude`/`longitude` are populated only when the organizer picked a
 * Places suggestion. With both present this renders an interactive Google map
 * with a marker on the actual building. With either missing it keeps the
 * token-drawn street grid: suggestive of a map without claiming to be one,
 * which is exactly as much as we know. A marker at (0, 0) would be a
 * confident lie — Null Island, in the Atlantic off Ghana.
 *
 * The stand-in used to sit on the dark hero atmosphere with a brand-gradient
 * pin and a coloured glow. It is a recessed WELL with a hairline grid now, and
 * the pin is the wayfinding violet — a map pin is the most literal wayfinding
 * mark on the site, which is exactly what that accent is still for.
 */
export function VenueCard({ event }: { event: EventDetail }) {
  const query = encodeURIComponent(`${event.venue}, ${event.city}`);
  const directions = `https://www.google.com/maps/search/?api=1&query=${query}`;
  const pinned =
    event.latitude !== null &&
    event.latitude !== undefined &&
    event.longitude !== null &&
    event.longitude !== undefined;

  if (pinned) {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-surface p-card shadow-sm">
        <VenueMap
          venue={event.venue}
          city={event.city}
          latitude={event.latitude}
          longitude={event.longitude}
          height={240}
        />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="relative h-40 border-b border-border bg-sunken" aria-hidden>
        {/* A stylised street grid: suggestive of a map without claiming to be
            one, which is exactly as much as we actually know. */}
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgb(var(--border)) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--border)) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
        <span className="absolute left-1/2 top-1/2 inline-flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
          <MapPin className="size-5" />
        </span>
      </div>

      <div className="flex flex-col gap-4 p-card sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="truncate text-body-lg font-semibold text-foreground">{event.venue}</p>
          <p className="text-body-sm text-muted-foreground">{event.city}</p>
        </div>
        <a href={directions} target="_blank" rel="noopener noreferrer" className={ACTION_PILL}>
          <Navigation className="size-4" aria-hidden />
          Directions
          <span className="sr-only">(opens Google Maps in a new tab)</span>
        </a>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* FAQs and policies                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Answers to what people actually ask before paying.
 *
 * Every one of these is a PLATFORM fact, not an invented event detail: how
 * entry works (a signed QR, scanned once), what happens on a refund (tickets
 * are voided in the same transaction), what is stored (no card data — only
 * payment references). They're true for every event on the platform because
 * they're properties of the backend, so nothing here is guessed about this
 * particular organiser. Event-specific FAQs need an editable field the backend
 * doesn't have (BACKLOG.md item 16).
 *
 * Built on `<details>`/`<summary>`, which is a real disclosure widget: keyboard
 * operable, announced correctly, and open-by-URL-fragment friendly, with no
 * JavaScript and no ARIA to get wrong.
 */
const FAQS: { q: string; a: string }[] = [
  {
    q: 'How do I get in?',
    a: 'Your ticket is a QR code, cryptographically signed when it is issued. Gate staff scan it once; that scan marks it used, so a screenshot or a forwarded copy will not admit a second person.',
  },
  {
    q: 'Can I get a refund?',
    a: 'Refunds are issued by the organiser, and go back to the original payment method. When a refund is processed, the tickets it covers are voided in the same step — so a refunded ticket can never be used at the gate.',
  },
  {
    q: 'When should I arrive?',
    a: 'Doors typically open shortly before the start time, and scanning stays open for a grace period after it. Arrive a little early if you would rather not queue.',
  },
  {
    q: 'Are my card details stored?',
    a: 'No. Payments are handled by the payment provider and this platform keeps only their reference ids and the amount — never a card number.',
  },
];

/* -------------------------------------------------------------------------- */
/* Running order                                                              */
/* -------------------------------------------------------------------------- */

const TIMELINE_LABEL: Record<TimelineKind, string> = {
  doors: 'Doors',
  opening: 'Opening',
  session: 'Session',
  intermission: 'Interval',
  main: 'Main',
  after_party: 'After party',
  closing: 'Closing',
};

/**
 * What happens when, as the organiser entered it.
 *
 * Times are formatted from a stored instant, so an after-party at 00:30 sits
 * AFTER the 19:00 doors rather than sorting to the top — which is what a
 * time-of-day field would have done. An entry with no time says so rather than
 * borrowing the event's start: the organiser deliberately left it open.
 *
 * Returns `null` when empty. There is no "running order coming soon" — an
 * empty section is a promise the page cannot keep.
 */
export function RunningOrder({ entries }: { entries: EventTimelineEntry[] }) {
  if (!entries.length) return null;
  return (
    <ol className="flex flex-col">
      {entries.map((entry, index) => (
        <li key={entry.id} className="flex gap-4">
          {/* Ink, not violet: the rail is structure, and the accent is spent on
              the countdown and the map pin. */}
          <span className="flex flex-col items-center" aria-hidden>
            <span className="mt-2 size-2.5 shrink-0 rounded-full bg-foreground" />
            {index < entries.length - 1 ? <span className="w-px flex-1 bg-border-strong" /> : null}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 pb-5">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-body font-semibold text-foreground">{entry.label}</span>
              <span className="text-caption uppercase tracking-wide text-foreground-subtle">
                {TIMELINE_LABEL[entry.kind] ?? entry.kind}
              </span>
            </span>
            <span className="text-body-sm tabular-nums text-muted-foreground">
              {entry.starts_at ? (
                <time dateTime={machineDate(entry.starts_at)}>
                  {formatEventTime(entry.starts_at)}
                </time>
              ) : (
                'Time to be confirmed'
              )}
            </span>
            {entry.description ? (
              <span className="text-body-sm text-muted-foreground">{entry.description}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/* -------------------------------------------------------------------------- */
/* Accessibility                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The organiser's own access notes, verbatim.
 *
 * Rendered ONLY when they wrote something. There is no generated summary and
 * no icon grid of amenities: this page has no columns for step-free access,
 * hearing loops or accessible parking, and a row of ticked icons nobody
 * verified is the worst possible thing to fabricate — someone decides whether
 * they can attend at all on the strength of it.
 */
export function AccessibilityNotes({ notes }: { notes: string }) {
  if (!notes.trim()) return null;
  return (
    <div className="flex gap-3 rounded-xl border border-border bg-sunken p-card">
      <Accessibility className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="whitespace-pre-line text-body text-foreground">{notes}</p>
        <p className="text-caption text-foreground-subtle">
          Written by the organiser. Contact them if you need something that is not covered here.
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* FAQs                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The organiser's own questions, above the platform's.
 *
 * Their order matters: "is there parking at THIS venue" beats "how does a QR
 * ticket work" for someone deciding tonight. The platform set below is about
 * how the platform works and is identical everywhere, which is exactly why it
 * is a constant rather than something every organiser retypes.
 */
export function EventFaqs({ faqs }: { faqs: EventFaq[] }) {
  if (!faqs.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {faqs.map((faq) => (
        <Faq key={faq.id} question={faq.question} answer={faq.answer} />
      ))}
    </div>
  );
}

/**
 * One disclosure. Shared by the organiser's questions and the platform's — they
 * were two copies of the same markup, which is how a list ends up with two
 * slightly different rows in it.
 */
function Faq({ question, answer }: { question: string; answer: string }) {
  return (
    <details className="group rounded-xl border border-border bg-surface shadow-sm">
      <summary
        className={cn(
          'flex min-h-control cursor-pointer list-none items-center justify-between gap-4 p-card text-body font-medium text-foreground',
          'rounded-xl transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          '[&::-webkit-details-marker]:hidden',
        )}
      >
        {question}
        {/* PLUS BECOMES MINUS — one drawing, not two icons.
            It is a single SVG whose vertical stroke collapses to zero height on
            `[open]`, so the + folds into the − rather than being swapped for a
            different glyph. Two icons cross-fading always shows a frame of both.

            Done in CSS on the parent's `[open]` state rather than from React
            state, because the disclosure is a native `<details>`: it works
            before hydration, with JavaScript off, and with the browser's own
            find-in-page (which opens a closed `<details>` to reveal a match).
            A hand-rolled accordion loses all three. */}
        <span
          className="relative inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors duration-fast group-hover:border-border-strong group-hover:text-foreground"
          aria-hidden
        >
          <svg viewBox="0 0 16 16" className="size-3.5" fill="none" strokeLinecap="round">
            <line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="1.75" />
            <line
              x1="8"
              y1="3"
              x2="8"
              y2="13"
              stroke="currentColor"
              strokeWidth="1.75"
              className="origin-center transition-transform duration-fast [transform:scaleY(1)] group-open:[transform:scaleY(0)] motion-reduce:transition-none"
            />
          </svg>
        </span>
      </summary>
      {/* ── THE ANSWER NEEDS ROOM, AND A LINE ABOVE IT ──────────────────
          It used to be `px-card pb-card` with NO top padding, so the answer
          began immediately under the summary's own bottom padding — against
          the tinted open row, a one-word answer ("yes") read as a caption
          stuck to the question rather than as the body of the disclosure.

          A hairline inset to the text column separates the two without adding
          a second box, and `leading-relaxed` gives a real paragraph the
          measure it needs — most of these answers are several sentences about
          a refund or a bag policy, and this is the one place on the page
          somebody reads carefully. */}
      <div className="mx-card border-t border-border pb-card pt-card-lg">
        <p className="whitespace-pre-line text-body leading-relaxed text-muted-foreground">
          {answer}
        </p>
      </div>
    </details>
  );
}

export function Faqs() {
  return (
    <div className="flex flex-col gap-2">
      {FAQS.map((faq) => (
        <Faq key={faq.q} question={faq.q} answer={faq.a} />
      ))}
    </div>
  );
}

const POLICIES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: QrCode,
    title: 'One scan per ticket',
    body: 'Each ticket admits one person, once. Re-scans are declined at the gate.',
  },
  {
    icon: Receipt,
    title: 'Refunds via the organiser',
    body: 'Approved refunds return to the original payment method and void the tickets.',
  },
  {
    icon: ShieldCheck,
    title: 'No card details stored',
    body: 'Only the payment provider’s reference ids and the amount are kept.',
  },
  {
    icon: Ticket,
    title: 'Availability is checked at purchase',
    body: 'Counts on this page are live, and stock is confirmed again when you book.',
  },
];

/**
 * The organiser's own rules, above the platform's.
 *
 * ORDER IS NOT ARBITRARY. "Carry a photo ID" is the one that stops somebody at
 * the gate; "no card data is stored" is reassurance. The specific, actionable
 * rules come first and the standing guarantees follow, because a reader gives
 * this section about four seconds.
 *
 * Renders NOTHING when the organiser set none — not a heading with an empty
 * space under it, and not a placeholder inviting them to add some (this is the
 * public page; that prompt belongs in the studio).
 */
export function OrganizerPolicies({ policies }: { policies: EventPolicy[] }) {
  if (!policies.length) return null;
  return (
    <ul className="flex flex-col gap-3">
      {policies.map((policy) => (
        <li
          key={policy.title}
          className="flex items-start gap-3 rounded-lg border border-border bg-sunken p-4"
        >
          <span
            className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-surface text-muted-foreground"
            aria-hidden
          >
            <Info className="size-4" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-body font-semibold text-foreground">{policy.title}</p>
            {/* `whitespace-pre-line`, so an organiser's line breaks survive.
                A list of prohibited items typed one per line collapsing into a
                paragraph is the difference between readable and not. */}
            <p className="whitespace-pre-line text-body-sm text-muted-foreground">{policy.body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Policies() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {POLICIES.map((policy) => (
        <li key={policy.title} className="flex items-start gap-3">
          <span
            className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
            aria-hidden
          >
            <policy.icon className="size-5" />
          </span>
          <div className="flex flex-col gap-0.5">
            <p className="text-body font-semibold text-foreground">{policy.title}</p>
            <p className="text-body-sm text-muted-foreground">{policy.body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}


/**
 * The event's trailer.
 *
 * ── IT IS AN EMBED, AND THAT IS A DELIBERATE LIMIT ────────────────────────
 *
 * The server stores only a URL it BUILT itself from an extracted YouTube or
 * Vimeo id — never the string an organiser pasted — so what lands in this
 * iframe is one of exactly two hosts with a documented, sandboxed player. That
 * is what makes rendering somebody else's document beside ours defensible at
 * all, and it is why this component does no URL handling of its own: any
 * cleverness here would be a second place for the rule to live.
 *
 * ── LOADED LAZILY, BEHIND THE FOLD ────────────────────────────────────────
 *
 * `loading="lazy"` because a YouTube player is ~900 KB of script and this sits
 * below the photograph, the price and the buy button — the three things
 * anybody opened the page for. It must never compete with them for the first
 * paint.
 */
export function EventVideo({ video }: { video: EventMedia }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-sunken">
      {/* 16:9 by construction rather than by a fixed height: a hard height is
          how an embed ends up letterboxed on a phone and cropped on a desktop. */}
      <div className="relative aspect-video">
        <iframe
          src={video.url}
          title={video.alt_text || 'Event video'}
          loading="lazy"
          // The narrowest set a player actually needs. `allow-same-origin` is
          // absent on purpose — the embed hosts do not require it, and granting
          // it would hand the frame our origin.
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          className="absolute inset-0 size-full border-0"
        />
      </div>
      {video.caption ? (
        <p className="px-4 py-3 text-caption text-muted-foreground">{video.caption}</p>
      ) : null}
    </div>
  );
}
