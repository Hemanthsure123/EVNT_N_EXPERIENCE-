'use client';

import * as React from 'react';
import { Globe, Share2 } from 'lucide-react';
import {
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
  type Draft,
  type Issue,
} from '@/lib/organizer/wizard/model';
import { formatEventDateLong } from '@/lib/discovery/format';
import { cn } from '@/lib/utils/cn';
import { NotStored, StepHeader, TextArea, TextField } from './fields';

/**
 * How the event appears in search results and in a shared link.
 *
 * ── THE PREVIEW IS THE REAL FALLBACK CHAIN, NOT A MOCK-UP ─────────────────
 *
 * `app/(site)/events/[id]/generateMetadata` resolves the title as
 * `seo_title || title` and the description as
 * `seo_description || short_description || <derived line>`. This step applies
 * exactly that chain, from the same fields. So an organizer who leaves both
 * boxes empty sees what will actually be emitted — which is the only version
 * of this preview worth showing. A picture of an invented result would teach
 * someone to trust a number nobody computed.
 *
 * ── NO SLUG, NO KEYWORDS, NO SCORE ────────────────────────────────────────
 *
 * The public route is `/events/{uuid}` (`app/(site)/events/[id]`), so a slug
 * field would be a picture of a URL that will never exist. `<meta keywords>`
 * has been ignored by every major engine for over a decade. And an "SEO
 * score" out of 100 is a number with no method behind it — the character
 * counters below are the real constraint, because they are where Google
 * truncates and where the columns stop.
 */

type Props = {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  issues: Issue[];
};

const errorFor = (issues: Issue[], field: string) =>
  issues.find((issue) => issue.field === field)?.message;

export function SeoStep({ draft, update, issues }: Props) {
  const derivedDescription = React.useMemo(() => {
    if (!draft.title.trim()) return '';
    const where = [draft.venue.trim(), draft.city.trim()].filter(Boolean).join(', ');
    const when = draft.startsAt ? formatEventDateLong(new Date(draft.startsAt).toISOString()) : '';
    return [
      draft.title.trim(),
      where ? ` at ${where}` : '',
      when ? ` — ${when}` : '',
      '.',
    ].join('');
  }, [draft.title, draft.venue, draft.city, draft.startsAt]);

  const title = draft.seoTitle.trim() || draft.title.trim();
  const description =
    draft.seoDescription.trim() || draft.shortDescription.trim() || derivedDescription;

  return (
    <div className="flex flex-col gap-block">
      <StepHeader
        title="Search appearance"
        blurb="What a search engine and a shared link show. Both boxes are optional — left empty, the page falls back to your title and summary, which is what the preview below is showing you."
      />

      <TextField
        id="event-seo-title"
        label="Search title"
        value={draft.seoTitle}
        onChange={(seoTitle) => update({ seoTitle })}
        placeholder={draft.title || 'Sunburn Arena ft. Martin Garrix — Mumbai'}
        max={SEO_TITLE_MAX}
        error={errorFor(issues, 'seoTitle')}
        hint="Google cuts off around 60–70 characters. Put the artist and the city in the first half."
      />

      <TextArea
        id="event-seo-description"
        label="Search description"
        value={draft.seoDescription}
        onChange={(seoDescription) => update({ seoDescription })}
        placeholder={
          draft.shortDescription ||
          'Book tickets for four stages and twelve artists on the Mumbai waterfront, 14 March.'
        }
        rows={3}
        error={errorFor(issues, 'seoDescription')}
        hint={`Around ${SEO_DESCRIPTION_MAX} characters before it is truncated. It is an advert, not a summary — say why to come, and name the date.`}
      />

      {title ? (
        <div className="flex flex-col gap-stack-lg">
          <SearchPreview title={title} description={description} eventId={draft.eventId} />
          <SharePreview
            title={title}
            description={description}
            posterUrl={draft.posterUrl}
            city={draft.city}
          />
          {!draft.seoTitle.trim() || !draft.seoDescription.trim() ? (
            <p className="text-caption text-muted-foreground">
              {draft.seoTitle.trim()
                ? 'The description above is your one-line summary. '
                : draft.seoDescription.trim()
                  ? 'The title above is your event title. '
                  : 'Both lines above are falling back to your event title and summary. '}
              That is exactly what the live page will emit — the fields here only override it.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-sunken p-card-lg text-center">
          <p className="text-body-sm text-muted-foreground">
            Add a title on the Basics step and the preview appears here.
          </p>
        </div>
      )}

      <NotStored>
        There is no slug field: the public route is <code>/events/{'{uuid}'}</code>, so a custom URL
        would be a picture of a page that does not exist. No keywords field either — search engines
        stopped reading that tag over a decade ago — and no “SEO score”, which would be a number
        with no method behind it. The counters above are the real limits: they are where the columns
        stop and where Google truncates.
      </NotStored>
    </div>
  );
}

/** A Google result, at the proportions and truncation points of a real one. */
function SearchPreview({
  title,
  description,
  eventId,
}: {
  title: string;
  description: string;
  eventId: string | null;
}) {
  return (
    <figure className="flex flex-col gap-stack rounded-xl border border-border bg-surface p-card shadow-sm">
      <figcaption className="flex items-center gap-1.5 text-caption text-muted-foreground">
        <Globe className="size-3.5 text-primary" aria-hidden />
        In a search result
      </figcaption>
      <div className="flex flex-col gap-0.5">
        <p className="truncate text-caption text-muted-foreground">
          curatix.in › events › {eventId ? `${eventId.slice(0, 8)}…` : '…'}
        </p>
        {/* Violet as a LINK, which is the one job the accent kept. */}
        <p className="line-clamp-1 text-body text-primary">{truncate(title, SEO_TITLE_MAX)}</p>
        <p className="line-clamp-2 text-body-sm text-muted-foreground">
          {truncate(description, SEO_DESCRIPTION_MAX)}
        </p>
      </div>
    </figure>
  );
}

/** A link card, as WhatsApp, Slack and X render one from the OpenGraph tags. */
function SharePreview({
  title,
  description,
  posterUrl,
  city,
}: {
  title: string;
  description: string;
  posterUrl: string;
  city: string;
}) {
  return (
    <figure className="flex flex-col gap-stack">
      <figcaption className="flex items-center gap-1.5 text-caption text-muted-foreground">
        <Share2 className="size-3.5 text-primary" aria-hidden />
        Shared as a link
      </figcaption>
      <div className="max-w-sm overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        {posterUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- a blob: URL
             while the cover is still local, and a storage-adapter URL after;
             neither is a host next/image can be configured for. */
          <img src={posterUrl} alt="" className="aspect-card w-full object-cover" />
        ) : (
          <div
            className={cn(
              'flex aspect-card w-full items-center justify-center bg-muted px-card text-center',
            )}
          >
            <p className="text-caption text-muted-foreground">
              No cover image — a link with no picture gets markedly fewer clicks.
            </p>
          </div>
        )}
        <div className="flex flex-col gap-0.5 border-t border-border p-card">
          <p className="text-caption uppercase tracking-wide text-muted-foreground">
            curatix.in{city ? ` · ${city}` : ''}
          </p>
          <p className="line-clamp-2 text-body-sm font-medium">{title}</p>
          <p className="line-clamp-2 text-caption text-muted-foreground">{description}</p>
        </div>
      </div>
    </figure>
  );
}

/** Cut at the last whole word before the limit, the way a search engine does —
 *  a mid-word chop makes the preview look broken rather than truncated. */
function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
