'use client';

import * as React from 'react';
import { Heart } from 'lucide-react';
import { useIsSaved } from '@/lib/discovery/use-favourites';
import { cn } from '@/lib/utils/cn';

/**
 * Save-for-later, as a CLIENT ISLAND inside an otherwise server-rendered card.
 *
 * Only this button hydrates — the card around it stays a Server Component with
 * zero JS. Making the whole card interactive to get one toggle would put a
 * hydration cost on every card in every rail.
 *
 * The card is wrapped in a link, so the click has to be stopped from
 * navigating; `preventDefault` + `stopPropagation` keeps the two affordances
 * separate. The label is a real toggle state for screen readers, not just an
 * icon swap.
 *
 * ── THE MOTION IS ONE BEAT, AND ONLY ON SAVE ──────────────────────────────
 *
 * A save fires a single pop plus a ring that expands once and fades. Unsaving
 * gets NO flourish: the celebration belongs to the affirmative action, and
 * animating a removal reads as a second confirmation of something the person
 * already decided.
 *
 * The card is NOT flown across the viewport into a Saved link. Signed out
 * there is no such link in the header — the flight would end at nothing — and
 * the card sits inside a scrolling rail whose position moves under a fixed
 * overlay. A beat at the point of contact is what the gesture actually needs:
 * it confirms the press landed.
 *
 * `motion-reduce:animate-none` on both layers, because a repeated pulse is
 * exactly what a vestibular-motion setting is asking us not to do.
 *
 * ── IT KEEPS `.glass-media`, AND THAT IS DELIBERATE ───────────────────────
 *
 * The light-first language moved almost all card chrome OFF the poster; this
 * button is one of the three controls that genuinely has to stay on it (with
 * share and the carousel's navigation). `.glass-media` is not theme-adaptive
 * precisely because what is behind it is an arbitrary photograph rather than
 * the page, so it must not be swapped for `.glass` here — that would put white
 * ink on a white frost in light mode.
 */
export function FavouriteButton({
  eventId,
  title,
  className,
}: {
  eventId: string;
  /** Used in the accessible label so the action names its subject. */
  title: string;
  className?: string;
}) {
  const { saved, toggle } = useIsSaved(eventId);

  // A counter rather than a boolean: re-keying the animated nodes is what
  // RESTARTS a CSS animation, so a rapid save/unsave/save plays a fresh beat
  // instead of silently reusing the finished one.
  //
  // Incremented from the CLICK, never from an effect watching `saved`. The
  // store reports `false` on the first render and the stored value on the
  // next — indistinguishable, to an effect, from somebody pressing save. That
  // version popped every already-saved card on the page at load.
  const [beat, setBeat] = React.useState(0);

  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? `Remove ${title} from saved` : `Save ${title} for later`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!saved) setBeat((count) => count + 1);
        toggle();
      }}
      className={cn(
        'glass-media relative inline-flex size-9 items-center justify-center rounded-full border text-on-gradient',
        'transition duration-fast ease-out hover:scale-[1.06] active:scale-95',
        'motion-reduce:hover:scale-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
    >
      {beat > 0 && saved ? (
        <span
          key={beat}
          aria-hidden
          // `border-current`, so the ring is whatever colour the button's ink
          // already is — white on the `.glass-media` scrim over a poster, the
          // muted ink on the light variant `event-row` overrides it to. A fixed
          // colour is invisible in one of those two, and this beat is the only
          // feedback that the press landed.
          className="pointer-events-none absolute inset-0 animate-ring-out rounded-full border-2 border-current motion-reduce:animate-none motion-reduce:opacity-0"
        />
      ) : null}
      <Heart
        key={`heart-${beat}`}
        className={cn(
          'size-4 transition-colors duration-fast',
          // ONLY THE FILL CHANGES. The stroke stays the ambient ink, so the
          // heart's OUTLINE keeps its contrast wherever this button is used —
          // white on a dark scrim over an arbitrary poster, muted ink on the
          // light bordered variant — and the saved state is carried by the
          // shape going solid, which is what a filled heart means everywhere.
          //
          // It was `fill-accent text-accent`. `--accent` was pink; it is the
          // deeper wayfinding VIOLET now, and recolouring the stroke as well as
          // the fill dropped the whole glyph to ~1.3:1 against the scrim — a
          // state change you could only see if you already knew it was there.
          saved && 'fill-destructive',
          beat > 0 && saved && 'animate-heart-pop motion-reduce:animate-none',
        )}
        aria-hidden
      />
    </button>
  );
}
