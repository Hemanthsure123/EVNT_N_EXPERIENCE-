import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ErrorScreen } from '@/components/illustrations/error-screen';
import { SceneNotFound } from '@/components/illustrations/scenes';

/**
 * The 404 for a route that EXISTS but whose content does not — an event id that
 * was archived, a city with no landing page, a performer whose profile is not
 * live. Every `notFound()` call inside `(site)` lands here.
 *
 * Distinct from `app/not-found.tsx` on purpose, and the difference is the
 * chrome: this one is wrapped by the site shell, so the reader keeps the
 * header's search, the city switcher and the footer. Those are far better exits
 * from "this specific event is gone" than two buttons on an empty page, because
 * the person who hit this was looking for something REAL and is one search away
 * from the next thing.
 *
 * Same illustration and the same words as the root 404, because from the
 * reader's side it is the same event — only the ways out differ.
 */
export default function SiteNotFound() {
  return (
    <ErrorScreen
      layout="inset"
      scene={<SceneNotFound className="h-40 w-auto sm:h-48" />}
      title="We couldn't find that"
      message="This page may have moved, or the event may no longer be listed. There's plenty else on."
      homeLabel="Go home"
      secondary={
        <Button asChild variant="outline">
          <Link href="/events">Browse events</Link>
        </Button>
      }
    />
  );
}
