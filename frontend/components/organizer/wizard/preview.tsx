'use client';

import * as React from 'react';
import { ArrowRight, CalendarDays, Building2, MapPin, Ticket } from 'lucide-react';
import { formatFromPrice, formatMoney } from '@/lib/discovery/format';
import { priceSummary, type Draft } from '@/lib/organizer/wizard/model';
import { cn } from '@/lib/utils/cn';

/**
 * The live preview.
 *
 * IT MIRRORS THE ATTENDEE CARD, using the same fields the real one reads
 * (`components/discovery/event-card.tsx`): poster, title, start time, venue +
 * city, organiser, and "from ₹X" derived from the cheapest tier. Nothing here
 * is decorative — if a field is not on the card, it is not in the preview, so
 * what an organizer sees is what a buyer will see.
 *
 * ── IT FOLLOWED THE CARD WHEN THE CARD MOVED ──────────────────────────────
 *
 * The public card is PORTRAIT now (a 3:4 poster with the text below it, `p-card`
 * padding, and the price on a ruled footer beside the quiet arrow). This drew a
 * 3:2 landscape card in a different reading order, which is the exact failure a
 * preview exists to prevent: an organizer cropping their artwork for a shape the
 * listing does not use. It now matches the card's geometry, its reading order
 * (poster → title → date → venue → organiser → price) and its price rendering,
 * including "Pricing soon" for an event with no tier yet — because that is the
 * string a buyer would actually see, and telling the organizer something kinder
 * would be telling them something false.
 *
 * TWO KNOWN DIVERGENCES, both because the wizard has no column to read:
 * the availability badge (nothing has been sold yet, so "Selling fast" would be
 * invented) and the category tile the real card falls back to when there is no
 * poster (`Event` has no category column — BACKLOG item 2). Neither is faked.
 *
 * It re-renders on every keystroke, which is free: this is a handful of divs
 * over already-in-memory state, with no query, no network and no layout
 * measurement.
 */
export function LivePreview({
  draft,
  organizationName,
}: {
  draft: Draft;
  organizationName: string;
}) {
  const summary = priceSummary(draft.tiers);
  const starts = draft.startsAt ? new Date(draft.startsAt) : null;
  const validDate = starts && !Number.isNaN(starts.valueOf());

  // Only what the organizer actually stated. Every one of these columns is
  // blank by default and the real event page omits the row when it is — so a
  // "Duration: —" here would be a preview of something that never renders.
  const minutes = Number(draft.durationMinutes);
  const facts: Array<{ label: string; value: string }> = [
    ...(Number.isInteger(minutes) && minutes > 0
      ? [{ label: 'Duration', value: formatMinutes(minutes) }]
      : []),
    ...(draft.language.trim() ? [{ label: 'Language', value: draft.language.trim() }] : []),
    ...(draft.ageRestriction.trim()
      ? [{ label: 'Age', value: draft.ageRestriction.trim() }]
      : []),
    ...(draft.accessibilityNotes.trim()
      ? [{ label: 'Access', value: 'Notes provided' }]
      : []),
  ];

  const metaTitle = draft.seoTitle.trim() || draft.title.trim();
  const metaDescription = draft.seoDescription.trim() || draft.shortDescription.trim();

  return (
    <div className="flex flex-col gap-block">
      <section aria-label="Attendee preview" className="flex flex-col gap-stack">
        <h3 className="text-caption uppercase tracking-wide text-muted-foreground">
          How attendees will see it
        </h3>

        {/* Same geometry as `EventCard`: portrait poster, chrome below it,
            `p-card`, and a ruled footer carrying the price. */}
        <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-md">
          <div className="relative aspect-portrait w-full overflow-hidden bg-muted">
            <div className="absolute inset-0 bg-gradient-to-br from-muted to-border" aria-hidden />
            {draft.posterUrl ? (
              /* A plain <img>: the source is a `blob:` URL for a file that has
                 not been uploaded yet, which next/image cannot optimise and
                 will refuse to load outright. */
              // eslint-disable-next-line @next/next/no-img-element
              <img src={draft.posterUrl} alt="" className="absolute inset-0 size-full object-cover" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center p-card text-center">
                <span className="text-caption text-muted-foreground">No cover image yet</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 p-card">
            <p
              className={cn(
                'line-clamp-2 text-body-lg font-semibold leading-tight',
                draft.title ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {draft.title || 'Your event title'}
            </p>

            <p className="flex items-center gap-1.5 text-body-sm text-muted-foreground">
              <CalendarDays className="size-4 shrink-0" aria-hidden />
              <span className="truncate">
                {validDate
                  ? starts.toLocaleString('en-IN', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      hour: 'numeric',
                      minute: '2-digit',
                    })
                  : 'Date and time'}
              </span>
            </p>

            <p className="flex items-center gap-1.5 text-body-sm text-muted-foreground">
              <MapPin className="size-4 shrink-0" aria-hidden />
              <span className="truncate">
                {draft.venue || draft.city ? (
                  <>
                    {draft.venue}
                    {draft.venue && draft.city ? ', ' : ''}
                    {draft.city}
                  </>
                ) : (
                  'Venue and city'
                )}
              </span>
            </p>

            <p className="flex items-center gap-1.5 text-caption text-foreground-subtle">
              <Building2 className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{organizationName || 'Your organisation'}</span>
            </p>

            <div className="mt-auto flex items-end justify-between gap-3 border-t border-border pt-stack-lg">
              <CardPrice lowestMinor={summary.lowestMinor} />
              {/* The card's quiet way in. Decorative here — there is nothing to
                  navigate to yet — so it is `aria-hidden`, exactly as it is on
                  the real card, where the stretched link already names the
                  destination. */}
              <span
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground"
                aria-hidden
              >
                <ArrowRight className="size-4" />
              </span>
            </div>
          </div>
        </article>
        {summary.lowestMinor === null ? (
          <p className="text-caption text-muted-foreground">
            The price appears on the card once you add a ticket tier.
          </p>
        ) : null}
      </section>

      <section aria-label="Pricing summary" className="flex flex-col gap-stack">
        <h3 className="text-caption uppercase tracking-wide text-muted-foreground">Pricing</h3>
        <dl className="grid grid-cols-2 gap-2">
          <Cell label="Lowest" value={summary.lowestMinor} />
          <Cell label="Highest" value={summary.highestMinor} />
          <Cell label="Average" value={summary.averageMinor} />
          <Cell label="Capacity" value={summary.capacity} raw />
        </dl>
        <div className="rounded-xl border border-border bg-surface p-card shadow-sm">
          <dt className="text-caption text-muted-foreground">Revenue potential</dt>
          <dd className="text-body-lg font-semibold tabular-nums">
            {formatMoney(summary.potentialMinor)}
          </dd>
          {/* Gross, and said so. The platform fee comes OUT of the total at
              settlement, so a "projected payout" here would be wrong by the
              fee — and it is the number an organizer would plan against. */}
          <p className="mt-1 text-caption text-muted-foreground">
            Every ticket sold at its listed price, before the platform fee.
          </p>
        </div>
      </section>

      {facts.length > 0 ? (
        <section aria-label="Quick facts" className="flex flex-col gap-stack">
          <h3 className="text-caption uppercase tracking-wide text-muted-foreground">
            Quick facts
          </h3>
          {/* Only the facts the organizer actually stated. A row with an em
              dash in it would be a claim that the field is empty on purpose;
              the real event page omits the row entirely, and so does this. */}
          <dl className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
            {facts.map((fact) => (
              <div key={fact.label} className="flex items-baseline gap-3 px-card py-2">
                <dt className="shrink-0 text-caption text-muted-foreground">{fact.label}</dt>
                <dd className="min-w-0 flex-1 text-right text-caption">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <section aria-label="Search preview" className="flex flex-col gap-stack">
        <h3 className="text-caption uppercase tracking-wide text-muted-foreground">
          Search result
        </h3>
        {/* The SAME fallback chain `generateMetadata` uses on the live page:
            `seo_title || title`, then `seo_description || short_description ||
            <derived line>`. Reproducing a DIFFERENT chain here is how a
            preview quietly stops matching the page it previews. There is no
            slug line: the public route is /events/{uuid}, so a slug preview
            would be a picture of a URL that never exists. */}
        <div className="rounded-xl border border-border bg-surface p-card shadow-sm">
          <p className="truncate text-body-sm text-primary">
            {metaTitle ? `${metaTitle} · Curatix` : 'Your event title · Curatix'}
          </p>
          {/* `success-subtle-foreground`, not `success`: the solid token is a
              FILL and does not clear AA as small text on a surface. */}
          <p className="truncate text-caption text-success-subtle-foreground">
            curatix.example/events/…
          </p>
          <p className="line-clamp-2 text-caption text-muted-foreground">
            {metaDescription ||
              'Your summary appears here, and in the link preview when someone shares the event.'}
          </p>
        </div>
      </section>

      {draft.tiers.length > 0 ? (
        <section aria-label="Ticket tiers" className="flex flex-col gap-stack">
          <h3 className="text-caption uppercase tracking-wide text-muted-foreground">Tiers</h3>
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
            {draft.tiers.map((tier) => (
              <li
                key={tier.key}
                className="flex items-center justify-between gap-2 px-card py-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Ticket className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate text-body-sm">{tier.name || 'Untitled tier'}</span>
                </span>
                {/* Right-aligned and tabular: a column of prices is read down,
                    not across. */}
                <span className="shrink-0 text-right text-body-sm tabular-nums text-foreground">
                  {tier.price === '' ? '—' : formatFromPrice(Math.round(Number(tier.price) * 100))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/**
 * The card's price line, in the card's own three shapes.
 *
 * `Free` is `success-subtle-foreground` rather than `success` — the solid token
 * is a fill and fails AA as text — and a missing price is "Pricing soon", not
 * a zero and not an em dash, because that is what the listing will say.
 */
function CardPrice({ lowestMinor }: { lowestMinor: number | null }) {
  if (lowestMinor === null) {
    return <p className="text-body-sm text-muted-foreground">Pricing soon</p>;
  }
  const price = formatFromPrice(lowestMinor);
  if (price === 'Free') {
    return <p className="text-body font-semibold text-success-subtle-foreground">Free</p>;
  }
  return (
    <p className="text-body-sm text-muted-foreground">
      from <span className="text-body font-semibold tabular-nums text-foreground">{price}</span>
    </p>
  );
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} hr`;
  return `${hours} hr ${rest} min`;
}

function Cell({ label, value, raw }: { label: string; value: number | null; raw?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-card shadow-sm">
      <dt className="truncate text-caption text-muted-foreground">{label}</dt>
      <dd className="truncate text-body-sm tabular-nums">
        {value === null ? (
          <span className="text-muted-foreground">—</span>
        ) : raw ? (
          value
        ) : (
          formatMoney(value)
        )}
      </dd>
    </div>
  );
}
