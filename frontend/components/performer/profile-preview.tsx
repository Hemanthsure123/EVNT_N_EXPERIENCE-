'use client';

import * as React from 'react';
import Link from 'next/link';
import { ExternalLink, Eye, Monitor, Smartphone } from 'lucide-react';
import { profileState, toPublicShape, useAct } from '@/lib/performer/studio';
import { PerformerProfile } from '@/components/hire/performer-profile';
import { PerformerCard } from '@/components/hire/performer-card';
import { ErrorState, Skeleton } from '@/components/organizer/primitives';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

/**
 * What a customer sees.
 *
 * ── THE SAME COMPONENT, NOT A COPY OF IT ──────────────────────────────────
 *
 * This renders the marketplace's own `PerformerProfile` and `PerformerCardTile`
 * against `toPublicShape(act)`. A preview built from a second set of markup is
 * a preview that quietly stops being true — and this is the screen a performer
 * uses to decide their profile is finished.
 *
 * The public API cannot serve this: `GET /performers/{id}` 404s for anything
 * not approved, which is every profile at the moment it most needs previewing.
 * Mapping the owner payload into the public shape is what makes a draft
 * previewable at all.
 *
 * ── THE WIDTH TOGGLE IS A CONTAINER, NOT A DEVICE EMULATOR ────────────────
 *
 * It constrains the preview to a phone-width column so the owner can see how
 * their tagline wraps. It does not claim to emulate a device; the real page is
 * one link away and is the honest check.
 */
export function ProfilePreview({ performerId }: { performerId: string }) {
  const act = useAct(performerId);
  const [narrow, setNarrow] = React.useState(false);

  if (act.isError) {
    return (
      <ErrorState
        message="Could not load your profile."
        onRetry={() => void act.refetch()}
        className="rounded-xl border border-border bg-surface"
      />
    );
  }

  if (act.isPending || !act.data) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }

  const state = profileState(act.data);
  const publicShape = toPublicShape(act.data);
  const live = act.data.status === 'live';

  return (
    <div className="flex flex-col gap-block">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-h2">Preview</h1>
          <p className="text-body-sm text-muted-foreground">
            Exactly what a customer sees — the same page the marketplace renders.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* A segmented control: pill-shaped track, pill-shaped segments, and
              the SELECTED one wears the butter `--nav-active` pill — the same
              colour that means "chosen" everywhere else in the studio. */}
          <div
            role="group"
            aria-label="Preview width"
            className="flex rounded-full border border-border p-1"
          >
            {[
              { id: 'wide', label: 'Full width', icon: Monitor, value: false },
              { id: 'narrow', label: 'Phone width', icon: Smartphone, value: true },
            ].map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={narrow === option.value}
                onClick={() => setNarrow(option.value)}
                className={cn(
                  'inline-flex h-control-sm items-center gap-1.5 rounded-full px-3 text-label transition-colors duration-fast motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  narrow === option.value
                    ? 'bg-nav-active text-nav-active-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <option.icon className="size-3.5" aria-hidden />
                <span className="sr-only sm:not-sr-only">{option.label}</span>
              </button>
            ))}
          </div>

          {live ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/hire/${act.data.id}`} target="_blank" rel="noreferrer">
                Open the live page
                <ExternalLink className="size-3.5" aria-hidden />
              </Link>
            </Button>
          ) : null}
        </div>
      </header>

      {/* The preview is accurate; whether anyone can REACH it is a separate
          fact, and conflating the two is how a performer ends up believing a
          draft is live. */}
      {!live ? (
        <p className="flex items-start gap-2 rounded-xl border border-border bg-sunken p-card text-body-sm">
          <Eye className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            <span className="font-medium">{state.label}.</span>{' '}
            <span className="text-muted-foreground">
              This is how the page will look, but nobody can reach it yet. {state.detail}
            </span>
          </span>
        </p>
      ) : null}

      <section className="flex flex-col gap-stack">
        <h2 className="text-body-sm font-semibold">In search results</h2>
        <div className="max-w-xs">
          <PerformerCard performer={publicShape} />
        </div>
        <p className="text-caption text-muted-foreground">
          This card is what people scroll past. Your first photo, your stage name and your tagline
          do nearly all the work.
        </p>
      </section>

      <section className="flex flex-col gap-stack">
        <h2 className="text-body-sm font-semibold">The profile page</h2>
        <div
          className={cn(
            'overflow-hidden rounded-xl border border-border bg-background transition-[max-width] duration-base motion-reduce:transition-none',
            narrow ? 'max-w-sm' : 'max-w-none',
          )}
        >
          <div className="p-card">
            <PerformerProfile performer={publicShape} />
          </div>
        </div>
      </section>
    </div>
  );
}
