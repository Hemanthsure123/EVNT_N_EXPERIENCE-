import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ErrorScreen } from '@/components/illustrations/error-screen';
import { SceneNotFound } from '@/components/illustrations/scenes';

/**
 * The 404 for a URL that matched no route at all.
 *
 * ── WHY THE BIG "404" IS GONE ────────────────────────────────────────────
 *
 * It used to be the first and largest thing on the page, set in the brand
 * gradient at `text-display`. A three-digit HTTP status code is jargon: it is
 * meaningful to the people who built the site and to nobody who mistyped a
 * link. The illustration now carries the "you are lost" in the half-second
 * before anyone reads, and the heading says it in words.
 *
 * (The type-scale note in tailwind.config.ts calls this file out as the one
 * unguarded `text-display` call site. It no longer is — which only makes the
 * display rung cheaper to retune, not more expensive.)
 *
 * ── STILL A SERVER COMPONENT ─────────────────────────────────────────────
 *
 * There is nothing interactive here: no `reset` (Next gives a not-found
 * boundary none, because there is nothing to retry), no state, two links. It
 * renders inside the ROOT layout only — an unmatched URL never resolves to a
 * route group, so there is no header or footer around this one, which is why it
 * fills the viewport.
 */
export default function NotFound() {
  return (
    <ErrorScreen
      scene={<SceneNotFound className="h-40 w-auto sm:h-48" />}
      title="Page not found"
      message="This link doesn't lead anywhere — it may have moved, or the address may have a typo in it."
      homeLabel="Go home"
      secondary={
        <Button asChild variant="outline">
          <Link href="/events">Browse events</Link>
        </Button>
      }
    />
  );
}
