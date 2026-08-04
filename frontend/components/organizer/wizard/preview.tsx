'use client';

import * as React from 'react';
import { Eye } from 'lucide-react';
import { EventPageBody } from '@/components/event/event-page-body';
import { draftToPreview } from '@/lib/organizer/wizard/preview-event';
import type { Draft } from '@/lib/organizer/wizard/model';

/**
 * The preview IS the event page.
 *
 * ── WHAT THIS REPLACED, AND WHY ───────────────────────────────────────────
 *
 * This used to be a hand-drawn impression: the attendee CARD, four pricing
 * stat tiles, a quick-facts list and a mock Google result. It mirrored the
 * card faithfully — but the card is not what an organizer is about to publish.
 * The question before pressing Submit is *what will people see when they open
 * this*, and the answer is a page, not a tile.
 *
 * Maintaining a second drawing of that page had already cost accuracy: the
 * search snippet claimed to apply the same metadata fallback chain as
 * `generateMetadata` and did not, and the Average price tile was an unweighted
 * mean of tier prices — a number nobody is ever charged.
 *
 * So it renders `EventPageBody`, the exact component `app/(site)/events/[id]`
 * renders, fed by `draftToPreview` which shapes the local draft the way the API
 * would return it. Same gallery, same badges, same countdown, same ticket
 * panel, same "only render what the organiser supplied" rules. There is no
 * longer a layout that can be right in one place and wrong in the other.
 *
 * ── IT IS SCALED, NOT SIMPLIFIED ──────────────────────────────────────────
 *
 * The pane is a few hundred pixels wide; the page is designed for a viewport.
 * Rendering a squeezed variant would preview a layout nobody gets, so the body
 * is laid out at a real desktop width and scaled down with a transform. What is
 * on screen is geometrically the desktop page: the two-column grid with the
 * sticky ticket rail, because that is what most of the audience will see.
 *
 * `transform` scales paint, not layout, so the inner tree still lays out at
 * `PREVIEW_WIDTH` and every breakpoint resolves as it would on a desktop. The
 * wrapper's height is corrected by the same factor, so the pane scrolls the
 * real distance instead of leaving a long blank tail.
 */

/** The viewport the preview pretends to be — past the `lg` (1024px) breakpoint
 *  where the ticket rail becomes sticky, so the two-column page is what shows. */
const PREVIEW_WIDTH = 1180;

export function LivePreview({
  draft,
  organizationName,
}: {
  draft: Draft;
  organizationName: string;
}) {
  /**
   * `now` is pinned per render pass rather than read on every call inside the
   * mapper, so the phase badge, the countdown and the derived "from" price all
   * agree on one instant. It refreshes on any draft edit — often enough for a
   * preview, and never mid-paint.
   */
  const { event, tiers, content } = React.useMemo(
    () => draftToPreview(draft, organizationName),
    [draft, organizationName],
  );

  const frame = React.useRef<HTMLDivElement>(null);
  const inner = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState<number | null>(null);
  const [innerHeight, setInnerHeight] = React.useState(0);

  // The frame's own width decides the scale, MEASURED rather than assumed: the
  // pane is a sticky aside at `xl` and a full-width drawer below it, which are
  // very different widths for the same component.
  React.useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    setWidth(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  // The unscaled height of the page, so the wrapper can reserve exactly that
  // times the scale and the pane does not scroll past a blank region.
  React.useEffect(() => {
    const node = inner.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setInnerHeight(entry.contentRect.height));
    observer.observe(node);
    setInnerHeight(node.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, [event, tiers, content]);

  const scale = width ? Math.min(1, width / PREVIEW_WIDTH) : null;

  return (
    <div className="flex flex-col gap-2">
      <p className="inline-flex items-center gap-1.5 text-caption uppercase tracking-wide text-foreground-subtle">
        <Eye className="size-3.5" aria-hidden />
        Preview — the page as attendees will see it
      </p>

      {/* A PICTURE of a page, not a page. Nothing inside is a real
          destination, so `inert` keeps a keyboard from walking into a scaled
          clone of the site and getting stranded in links that go nowhere —
          and it makes the whole subtree invisible to assistive tech, which is
          right: a screen-reader user gets the wizard's own fields and the
          Review step's checklist, not a duplicate of the page read aloud. */}
      <div
        ref={frame}
        className="overflow-hidden rounded-xl border border-border bg-background"
        role="img"
        aria-label={`Preview of the event page for ${event.title}`}
      >
        <div style={scale ? { height: innerHeight * scale } : undefined}>
          <div
            ref={inner}
            inert
            style={{
              width: PREVIEW_WIDTH,
              transform: scale ? `scale(${scale})` : undefined,
              transformOrigin: 'top left',
            }}
          >
            <EventPageBody event={event} tiers={tiers} content={content} preview />
          </div>
        </div>
      </div>
    </div>
  );
}
