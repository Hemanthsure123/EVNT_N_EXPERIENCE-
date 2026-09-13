'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { EventPageBody } from '@/components/event/event-page-body';
import { useAuth } from '@/lib/auth/auth-provider';
import { useOrganizations } from '@/lib/identity/scope';
import { draftStorageKey, restoreDraft, type Draft } from '@/lib/organizer/wizard/model';
import { draftToPreview } from '@/lib/organizer/wizard/preview-event';

/**
 * THE PREVIEW, AS ITS OWN PAGE.
 *
 * ── WHY THIS IS NOT BLOCKED ON SAVING ────────────────────────────────────
 *
 * The obvious objection to a new-tab preview is that the wizard is local-first:
 * a second tab cannot see a draft the server has never been told about. That
 * is true of the SERVER and not of the draft, which lives in `localStorage` —
 * the same origin, readable from any tab. So this reads the stored draft
 * directly and needs no event id, no save, and no endpoint.
 *
 * It uses the SAME key builder the wizard writes with (`draftStorageKey`) and
 * the SAME restorer (`restoreDraft`), rather than a second parser of the same
 * blob. A preview that read the draft its own way would drift from the editor
 * the first time a field was added — which is exactly how the group-band rows
 * crashed the wizard.
 *
 * ── AND IT RENDERS THE REAL PAGE ─────────────────────────────────────────
 *
 * `EventPageBody` is the component `app/(site)/events/[ref]` renders. Not a
 * facsimile, not a "preview view" that drifts — the actual public page, over
 * `draftToPreview`'s shape. `preview` tells it the CTA is inert: a Book
 * tickets button that reserved real inventory from a preview would be the
 * worst possible thing on this screen.
 *
 * ── THE COVER MAY BE MISSING, HONESTLY ───────────────────────────────────
 *
 * While a cover is waiting to upload, `posterUrl` is a `blob:` URL scoped to
 * the DOCUMENT that made it — it resolves to nothing in this tab, and
 * `restoreDraft` already drops it for exactly that reason. So a not-yet-saved
 * cover shows as no cover here rather than as a broken image, and the Media
 * step is where it gets fixed.
 */
export default function EventPreviewPage() {
  const params = useSearchParams();
  const { user, status } = useAuth();
  const organizationsQuery = useOrganizations();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [missing, setMissing] = React.useState(false);

  // `?eventId=` picks the edit draft's key; absent means the new-event draft.
  // Same suffix rule as the wizard — two pieces of work, two keys.
  const eventId = params?.get('eventId') ?? null;

  React.useEffect(() => {
    if (status !== 'authenticated' || !user) return;
    const key = draftStorageKey(user.id, eventId);
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        setMissing(true);
        return;
      }
      setDraft(restoreDraft(JSON.parse(raw) as Partial<Draft>, []));
    } catch {
      // A corrupt or unreadable store is "nothing to preview", never a crash
      // on a page whose whole job is to show something.
      setMissing(true);
    }
  }, [status, user, eventId]);

  if (status === 'unknown') return <Shell>Loading…</Shell>;
  if (status !== 'authenticated') return <Shell>Sign in to preview this event.</Shell>;
  if (missing) {
    return <Shell>No draft found. Open the event in the studio, then press Preview again.</Shell>;
  }
  if (!draft) return <Shell>Loading…</Shell>;

  // The organization NAME, which the public page prints under "Organised by".
  // The draft holds an id; the display name comes from the account's own list,
  // and an empty string draws the section without a name rather than inventing
  // one.
  const organizationName =
    (organizationsQuery.data?.data ?? []).find((org) => org.id === draft.organizationId)?.name ??
    '';
  const { event, tiers, content } = draftToPreview(draft, organizationName);

  return (
    <div className="flex flex-col">
      {/* SAYS WHAT IT IS. Without it this is indistinguishable from the live
          page, and somebody would reasonably conclude the event was already
          published. */}
      <p className="bg-ink-900 px-4 py-2 text-center text-caption font-medium text-white">
        Preview — the page as attendees will see it. Nothing here is live.
      </p>
      <EventPageBody event={event} tiers={tiers} content={content} preview />
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-md items-center justify-center px-4 text-center text-body-sm text-muted-foreground">
      {children}
    </main>
  );
}
