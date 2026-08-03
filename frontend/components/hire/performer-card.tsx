import * as React from 'react';
import Link from 'next/link';
import { BadgeCheck, MapPin, Sparkles } from 'lucide-react';
import { PERFORMER_TYPE_LABELS, type PerformerCard as Card } from '@/lib/api/performers';
import { formatMoney } from '@/lib/discovery/format';
import { PerformerFrame } from './performer-art';
import { cn } from '@/lib/utils/cn';

/**
 * One act in the marketplace.
 *
 * ── EVERY FIGURE ON IT IS A COLUMN ────────────────────────────────────────
 *
 * Price, city, travel radius, years and the verification badge are all stored.
 * There is deliberately **no rating and no review count** — nothing on this
 * platform records a review, and a five-star row on a hiring decision worth
 * tens of thousands of rupees is the single worst thing to invent. What is
 * shown instead is what can be checked: how long they have worked, whether the
 * organisation behind them is verified, and what they cost.
 *
 * ── "FROM ₹X" IS A FLOOR, AND SAYS SO ─────────────────────────────────────
 *
 * `base_price_minor` is the act's own starting price, and a real quote comes
 * back against a real brief. Rendering it as a price would promise a number
 * nobody has agreed to. Null is "Price on ask", which is a real answer some
 * acts give — not a missing value to hide.
 *
 * ── NO PHOTO IS A DESIGN STATE, NOT A GREY BOX ────────────────────────────
 *
 * Most newly-approved acts have none. The frame paints the act's pastel plate
 * with its modelled object on it (`performer-art.tsx`) rather than `bg-muted`
 * and the words "No photos yet", which read as an image that failed to load.
 *
 * ── IT IS 2-UP UNDER `sm` ─────────────────────────────────────────────────
 *
 * One card per row made every act a half-screen block, so browsing eight of
 * them was eight screens of scrolling — the opposite of what a marketplace
 * grid is for. Two-up means the type sizes step down with it: the name is
 * `text-body-sm`, the tagline `text-caption`, and the third genre chip is
 * dropped below `sm` rather than wrapping the row onto a fourth line.
 *
 * A server component: it holds no state, so it ships no JavaScript.
 */
export function PerformerCard({ performer, priority }: { performer: Card; priority?: boolean }) {
  const verified = performer.verified_level === 'verified';

  return (
    <Link
      href={`/hire/${performer.id}`}
      className={cn(
        'group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface',
        'transition-[border-color,transform] duration-base ease-out',
        'hover:-translate-y-0.5 hover:border-muted-foreground/30',
        'motion-reduce:transform-none motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      )}
    >
      <div className="relative">
        <PerformerFrame
          type={performer.performer_type}
          photoUrl={performer.photo_url}
          photoAlt={performer.photo_alt}
          priority={priority}
          className="aspect-feature w-full"
          artClassName="size-12 sm:size-16"
          imageClassName={cn(
            'transition-transform duration-slow ease-out',
            'group-hover:scale-[1.03] motion-reduce:transform-none motion-reduce:transition-none',
          )}
        />

        {performer.is_featured ? (
          <span className="glass-media absolute left-2 top-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption text-on-gradient sm:left-3 sm:top-3 sm:px-2.5 sm:py-1">
            <Sparkles className="size-3" aria-hidden />
            Featured
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3 sm:gap-2 sm:p-4">
        <div className="flex items-start gap-1.5">
          <h3 className="min-w-0 flex-1 truncate text-body-sm font-semibold text-foreground sm:text-body">
            {performer.stage_name}
          </h3>
          {verified ? (
            <BadgeCheck
              className="mt-0.5 size-4 shrink-0 text-primary"
              aria-label="Verified organiser"
            />
          ) : null}
        </div>

        <p className="truncate text-caption text-muted-foreground">
          {PERFORMER_TYPE_LABELS[performer.performer_type]}
          {performer.experience_years > 0 ? ` · ${performer.experience_years} yrs` : ''}
        </p>

        {performer.tagline ? (
          <p className="line-clamp-2 text-caption text-muted-foreground sm:text-body-sm">
            {performer.tagline}
          </p>
        ) : null}

        <p className="flex items-center gap-1.5 truncate text-caption text-muted-foreground">
          <MapPin className="size-3 shrink-0" aria-hidden />
          {performer.city}
          {performer.travel_radius_km > 0 ? ` · travels ${performer.travel_radius_km} km` : ''}
        </p>

        {performer.genres.length ? (
          <ul className="flex flex-wrap gap-1">
            {performer.genres.slice(0, 3).map((genre, index) => (
              <li
                key={genre}
                className={cn(
                  'rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground',
                  // The third chip only when there is room for it. Two-up on a
                  // 360px screen, three chips wrap and cost the card a line.
                  index === 2 ? 'hidden sm:block' : null,
                )}
              >
                {genre}
              </li>
            ))}
          </ul>
        ) : null}

        <p className="mt-auto pt-1.5 text-caption sm:pt-2 sm:text-body-sm">
          {performer.base_price_minor === null ? (
            <span className="text-muted-foreground">Price on ask</span>
          ) : (
            <>
              <span className="text-muted-foreground">from </span>
              <span className="font-medium tabular-nums text-foreground">
                {formatMoney(performer.base_price_minor)}
              </span>
            </>
          )}
        </p>
      </div>
    </Link>
  );
}
