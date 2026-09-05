import { EventDetailSkeleton } from '@/components/discovery/skeletons';
import { DeckSkeleton } from '@/components/event/deck-skeleton';

/**
 * Low-fidelity stand-in shaped like the real page — see skeletons.tsx.
 *
 * TWO of them, because there are two presentations. On a phone this route
 * resolves into the deck (see `deck-boot.tsx`), so a desktop-shaped skeleton
 * there would be a page nobody is about to see, followed by a deck — the flash
 * the cover exists to remove, moved one step earlier.
 */
export default function Loading() {
  return (
    <>
      <div className="hidden sm:block">
        <EventDetailSkeleton />
      </div>
      <DeckSkeleton />
    </>
  );
}
