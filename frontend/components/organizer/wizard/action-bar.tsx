'use client';

import * as React from 'react';
import { AlertTriangle, Check, CloudOff, Eye, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui';
import type { SaveState } from '@/lib/organizer/wizard/use-wizard';
import { cn } from '@/lib/utils/cn';

/**
 * The wizard's persistent action bar: where the draft stands, and the two
 * things you can do about it from any step.
 *
 * ── WHY THE SAVE STATE HAS TO BE DOWN HERE TOO ────────────────────────────
 *
 * It already exists at the TOP of the wizard, next to the back link. On the
 * Basics step that is fine, because the whole step fits on a screen. On
 * Tickets, Media and Details it is a thousand pixels above whatever somebody
 * is typing — so at the exact moment they finish a tier and wonder whether it
 * is stored, the answer is off-screen and the only way to see it is to scroll
 * away from the work. This is a form whose entire promise is that nothing is
 * lost; the evidence for that promise cannot be somewhere else.
 *
 * ── STICKY, NOT FIXED, AND THAT IS WHAT KEEPS THE LAST FIELD VISIBLE ──────
 *
 * `position: sticky; bottom: 0` on the LAST child of the wizard's editing
 * column. It floats over the content while there is still page below it, and
 * then comes to rest IN FLOW at the end — so the final field, and the step
 * footer's Next, are never sitting permanently underneath it and no spacer or
 * scroll padding is needed to uncover them. A `fixed` bar cannot do that: it
 * is out of flow at every scroll position, so the bottom of the form is
 * hidden until something pads it back into view, and that padding then has to
 * be kept in step with the bar's own height by hand.
 *
 * `fixed` would also have to span the viewport, which at `lg` means running
 * underneath the dashboard's sidebar. Staying inside the column means the bar
 * is exactly as wide as the form it belongs to.
 *
 * ── NEITHER BUTTON IS THE FILLED PILL ─────────────────────────────────────
 *
 * The wizard spends its one near-black action on the step footer's forward
 * button, and that rule is what makes the forward path a fixed target rather
 * than something to hunt for. A filled Save down here would be a second claim
 * to be the thing to press — and it would be a strange one, because the draft
 * has already saved itself. Save draft is `outline`, Preview is `ghost`.
 *
 * ── SAVE DRAFT IS A FLUSH, NOT THE ONLY SAVE ──────────────────────────────
 *
 * The wizard autosaves. This button exists because people press Save whether
 * or not you give them one, and because after a failure there has to be
 * something to press. It says "Save draft" rather than "Save" for that reason:
 * it does not publish, and nothing on this screen should suggest it might.
 */

export type SaveSummary = {
  label: string;
  /** A text token, never a fill. `text-warning` is 2.15:1 on the light canvas,
   *  which would make the offline line — the one somebody genuinely needs to
   *  read — the least readable thing in the bar. */
  tone: string;
  icon: React.ReactNode;
};

/**
 * The save state as one sentence.
 *
 * Exported, and the strings are word-for-word the ones the wizard's header
 * badge already shows, because two controls narrating the same three props in
 * two different vocabularies is how somebody concludes there are two saves.
 * (`SaveBadge` in `event-wizard.tsx` should call this rather than keep its own
 * copy — see the integration note in this change's report.)
 */
export function saveSummary(
  state: SaveState,
  error: string | null,
  savedAt: number | null,
  now = Date.now(),
): SaveSummary {
  const ago = savedAt ? Math.round((now - savedAt) / 60_000) : null;
  switch (state) {
    case 'saving':
      return {
        label: 'Saving…',
        tone: 'text-muted-foreground',
        icon: <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />,
      };
    case 'saved':
      return {
        label: ago && ago > 0 ? `All changes synced · ${ago}m ago` : 'Saved just now',
        tone: 'text-success-subtle-foreground',
        icon: <Check className="size-3.5" aria-hidden />,
      };
    case 'offline':
      return {
        // A flush that failed to reach the server also lands here, with its own
        // message — showing the fixed label over a stored cause would be the
        // bar knowing more than it says.
        label: error ?? 'Offline — changes stored on this device, will sync automatically',
        tone: 'text-warning-subtle-foreground',
        icon: <CloudOff className="size-3.5" aria-hidden />,
      };
    case 'error':
      return {
        label: error ?? 'Could not save',
        tone: 'text-destructive',
        icon: <AlertTriangle className="size-3.5" aria-hidden />,
      };
    case 'dirty':
      return { label: 'Unsaved changes', tone: 'text-muted-foreground', icon: null };
    case 'local':
    default:
      return { label: 'Saved on this device', tone: 'text-muted-foreground', icon: null };
  }
}

export function WizardActionBar({
  state,
  error,
  savedAt,
  onSaveDraft,
  onPreview,
  previewOpen,
  className,
}: {
  state: SaveState;
  error: string | null;
  savedAt: number | null;
  /** The wizard's `saveNow` — a flush of the autosave that was going to run
   *  anyway, and the retry after a failure. */
  onSaveDraft: () => void;
  /** Toggles the wizard's preview sheet. */
  onPreview: () => void;
  previewOpen?: boolean;
  className?: string;
}) {
  const [, tick] = React.useReducer((count: number) => count + 1, 0);
  React.useEffect(() => {
    // Once a minute, so "saved just now" ages into "3m ago" instead of freezing
    // at the moment of the last keystroke. A minute, not a second: this line is
    // reassurance, and a number that moves constantly reads as activity.
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const summary = saveSummary(state, error, savedAt);
  const saving = state === 'saving';

  return (
    <div
      className={cn(
        // `-mx-*` then `px-*`: the bar's surface runs to the column's edges
        // while its contents stay on the form's own gutter, so it reads as a
        // ledge under the form rather than a card floating on it.
        'sticky bottom-0 z-sticky -mx-card mt-stack border-t border-border px-card',
        // OPAQUE, not the `.glass` frost the shell header wears. Two reasons,
        // and the second is the real one: form text scrolling under a
        // translucent bar is unreadable in a way a page header over prose is
        // not, and `styles/globals.css` deliberately keeps `backdrop-filter` to
        // the SINGLE header bar because it repaints everything beneath it every
        // frame. A second blurred bar on the same screen doubles that cost on
        // the longest-scrolling page in the dashboard.
        'bg-elevated',
        // The device's own bottom inset, so the bar clears a home indicator.
        'pb-[env(safe-area-inset-bottom)]',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-stack py-stack">
        {/* `role="status"` + `aria-live="polite"`: a save landing is worth
            announcing, and worth announcing quietly — this changes every few
            seconds while somebody types. */}
        <p
          role="status"
          aria-live="polite"
          className={cn('inline-flex min-w-0 items-center gap-1.5 text-caption', summary.tone)}
        >
          {summary.icon}
          <span className="truncate">{summary.label}</span>
        </p>

        <div className="flex items-center gap-2">
          {/* Hidden from `xl`, where the live preview is a permanent column: a
              toggle for a sheet that is `xl:hidden` would be a control that
              does nothing on the widest screens, which is worse than one that
              is absent. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onPreview}
            aria-pressed={previewOpen}
            leftIcon={<Eye className="size-4" aria-hidden />}
            className="xl:hidden"
          >
            Preview event
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onSaveDraft}
            loading={saving}
            leftIcon={<Save className="size-4" aria-hidden />}
          >
            {/* The label does not change with the state. A button that reads
                "Saved" is a button that has stopped being an action, and after
                a failure the one control somebody needs is the one that says
                what it will do — which is the same thing it always does. */}
            Save draft
          </Button>
        </div>
      </div>
    </div>
  );
}
