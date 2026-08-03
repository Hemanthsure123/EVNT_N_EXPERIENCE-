import * as React from 'react';
import Link from 'next/link';
import {
  BadgeCheck,
  Clock,
  ExternalLink,
  Globe,
  Instagram,
  Languages,
  MapPin,
  Music4,
  Sparkles,
  Youtube,
} from 'lucide-react';
import {
  OCCASION_LABELS,
  PERFORMER_TYPE_LABELS,
  type PerformerDetail,
} from '@/lib/api/performers';
import { formatMoney } from '@/lib/discovery/format';
import { PerformerFrame } from './performer-art';
import { PhotoGallery } from './photo-gallery';
import { cn } from '@/lib/utils/cn';

/**
 * One act's profile.
 *
 * ── EVERY SECTION RENDERS ONLY IF IT HAS CONTENT ──────────────────────────
 *
 * Bio, genres, languages, occasions, set length and each social link are all
 * optional columns. A blank one means the performer did not say — so the row
 * is omitted rather than shown with a dash, exactly as the event page does it.
 * A profile with three filled sections should look deliberate, not broken.
 *
 * ── THERE ARE NO RATINGS, AND THE PAGE SAYS WHY IT TRUSTS WHAT IT SHOWS ───
 *
 * Nothing on this platform stores a review. Rather than invent stars, the
 * trust argument is made from things that ARE checkable: the organisation's
 * verification, how long the act has worked, and the fact that every listing
 * passed a human review before appearing at all.
 *
 * A server component — no state, so it ships no JavaScript beyond the gallery.
 */
export function PerformerProfile({ performer }: { performer: PerformerDetail }) {
  const verified = performer.verified_level === 'verified';

  const facts = [
    { icon: MapPin, label: 'Based in', value: performer.city },
    performer.travel_radius_km > 0
      ? { icon: MapPin, label: 'Travels', value: `Up to ${performer.travel_radius_km} km` }
      : null,
    performer.experience_years > 0
      ? {
          icon: Sparkles,
          label: 'Experience',
          value: `${performer.experience_years} year${performer.experience_years === 1 ? '' : 's'}`,
        }
      : null,
    performer.typical_set_minutes
      ? { icon: Clock, label: 'Typical set', value: formatMinutes(performer.typical_set_minutes) }
      : null,
    performer.languages.length
      ? { icon: Languages, label: 'Languages', value: performer.languages.join(', ') }
      : null,
  ].filter(Boolean) as { icon: typeof MapPin; label: string; value: string }[];

  const links = [
    performer.website_url ? { icon: Globe, label: 'Website', href: performer.website_url } : null,
    performer.instagram_url
      ? { icon: Instagram, label: 'Instagram', href: performer.instagram_url }
      : null,
    performer.youtube_url ? { icon: Youtube, label: 'YouTube', href: performer.youtube_url } : null,
  ].filter(Boolean) as { icon: typeof Globe; label: string; href: string }[];

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-14">
      <div className="flex min-w-0 flex-col gap-8 lg:gap-10">
        {/* An act with no photographs is the COMMON case for a newly-approved
            profile, and it used to be a dashed grey box with "No photos yet"
            in it — the largest element on the page, saying nothing. It is now
            the act's own pastel plate carrying its modelled object, the same
            frame the marketplace card uses, so the page opens with something
            designed rather than with an absence. */}
        {performer.photos.length ? (
          <PhotoGallery photos={performer.photos} name={performer.stage_name} />
        ) : (
          <PerformerFrame
            type={performer.performer_type}
            className="aspect-feature w-full rounded-2xl border border-border"
            artClassName="size-24 sm:size-28"
          />
        )}

        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-caption text-muted-foreground">
              <Music4 className="size-3.5" aria-hidden />
              {PERFORMER_TYPE_LABELS[performer.performer_type]}
            </span>
            {verified ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-caption text-secondary-foreground">
                <BadgeCheck className="size-3.5" aria-hidden />
                Verified organiser
              </span>
            ) : null}
            {performer.is_featured ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-caption text-muted-foreground">
                <Sparkles className="size-3.5" aria-hidden />
                Featured
              </span>
            ) : null}
          </div>

          <h1 className="text-h2 md:text-h1">{performer.stage_name}</h1>
          {performer.tagline ? (
            <p className="max-w-2xl text-body-lg text-muted-foreground">{performer.tagline}</p>
          ) : null}
        </header>

        <section className="flex flex-col gap-4">
          <h2 className="text-h4">Good to know</h2>
          {/* Two-up from the smallest screen. Each of these is a word or a
              short number, so one per row was five full-width cards. */}
          <dl className="grid grid-cols-2 gap-2 sm:gap-4">
            {facts.map((fact) => (
              <div
                key={fact.label}
                className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface p-3 sm:p-4"
              >
                <dt className="flex items-center gap-1.5 text-caption uppercase tracking-wide text-muted-foreground">
                  <fact.icon className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{fact.label}</span>
                </dt>
                <dd className="text-body-sm text-foreground">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {performer.bio ? (
          <section className="flex flex-col gap-4">
            <h2 className="text-h4">About</h2>
            <p className="max-w-2xl whitespace-pre-line text-body text-muted-foreground">
              {performer.bio}
            </p>
          </section>
        ) : null}

        {performer.genres.length ? (
          <section className="flex flex-col gap-4">
            <h2 className="text-h4">What they play</h2>
            <ul className="flex flex-wrap gap-2">
              {performer.genres.map((genre) => (
                <li
                  key={genre}
                  className="rounded-full border border-border px-3 py-1 text-body-sm text-muted-foreground"
                >
                  {genre}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {performer.occasions.length ? (
          <section className="flex flex-col gap-4">
            <h2 className="text-h4">Plays at</h2>
            <ul className="flex flex-wrap gap-2">
              {performer.occasions.map((occasion) => (
                <li
                  key={occasion}
                  className="rounded-full bg-muted px-3 py-1 text-body-sm text-muted-foreground"
                >
                  {OCCASION_LABELS[occasion] ?? occasion}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {links.length ? (
          <section className="flex flex-col gap-4">
            <h2 className="text-h4">Elsewhere</h2>
            <ul className="flex flex-wrap gap-2">
              {links.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex h-control items-center gap-2 rounded-lg border border-border px-3.5 text-label transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <link.icon className="size-4" aria-hidden />
                    {link.label}
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <aside className="lg:sticky lg:top-24">
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
          <div>
            <p className="text-caption uppercase tracking-wide text-muted-foreground">
              Starting from
            </p>
            <p className="mt-1 text-h3 tabular-nums">
              {performer.base_price_minor === null ? (
                <span className="text-body-lg text-muted-foreground">Price on ask</span>
              ) : (
                formatMoney(performer.base_price_minor)
              )}
            </p>
            {/* A FLOOR, and said so. The real number comes back as a quote
                against a real brief — rendering it as "the price" would
                promise something nobody has agreed to. */}
            <p className="mt-1 text-caption text-muted-foreground">
              {performer.base_price_minor === null
                ? 'They quote per event. Send a brief and they will come back with a number.'
                : 'A starting point. You get a real quote once they see your date and brief.'}
            </p>
          </div>

          <Link
            href={`/hire/new?type=${performer.performer_type}&city=${encodeURIComponent(performer.city)}`}
            className={cn(
              // `--cta`, not `--primary`. The primary ACTION is the near-black
              // pill; `--primary` is the wayfinding violet and is never a call
              // to action (see `discovery/cta.tsx`).
              'inline-flex h-control-lg items-center justify-center rounded-xl bg-cta px-5 text-label text-cta-foreground',
              'transition-colors hover:bg-cta-hover',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            Request a quote
          </Link>

          <p className="text-caption text-muted-foreground">
            You post one brief — the date, the city and your budget — and every act that fits
            answers it, including this one. No account needed to browse; you sign in to post.
          </p>

          <div className="border-t border-border pt-4">
            <p className="text-caption uppercase tracking-wide text-muted-foreground">Listed by</p>
            <p className="mt-1 flex items-center gap-1.5 text-body-sm">
              {performer.organization_name}
              {verified ? (
                <BadgeCheck className="size-4 text-primary" aria-label="Verified" />
              ) : null}
            </p>
            {/* The trust argument, made only from things that can be checked. */}
            <p className="mt-2 text-caption text-muted-foreground">
              {verified
                ? 'This organisation has been verified by Curatix, and every listing is reviewed before it appears.'
                : 'Every listing is reviewed by Curatix before it appears. This organisation has not completed verification yet.'}
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} minutes`;
  if (rest === 0) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${hours} hr ${rest} min`;
}
