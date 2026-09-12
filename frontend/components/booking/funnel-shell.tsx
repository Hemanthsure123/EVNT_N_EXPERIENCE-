'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import type { EventDetail, TicketTier } from '@/lib/api/types';
import type { EventQuestion, EventSlot } from '@/lib/api/event-content';
import { cancelBooking } from '@/lib/api/bookings';
import { eventPath } from '@/lib/events/ref';
import { bumpAllAttemptsForEvent } from '@/lib/booking/attempt';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer';
import { formatEventDate, formatEventTime } from '@/lib/discovery/format';
import { cn } from '@/lib/utils/cn';
import { BookingProvider, useBooking } from './booking-context';
import { CTA_PILL_LG } from './cta';

/**
 * The frame both checkout screens render inside.
 *
 * ── IT IS A CHECKOUT, NOT A PAGE ON A WEBSITE ─────────────────────────────
 *
 * This used to be a `Container` inside the public site layout, carrying a
 * stepper, a persistent order-summary card, and — through the layout above it —
 * the site header, a search field, the bottom tab bar and the footer. On a
 * phone that was roughly a full screen of chrome before the first ticket tier,
 * and the same event was drawn twice: once in the summary card and again in the
 * screen's own content.
 *
 * What replaces it is what a checkout needs and nothing else: one back control,
 * the name of the thing being bought, and the content. The route group above
 * (`app/(checkout)`) removed the site chrome; this removed the funnel's own.
 *
 * ── THE HEADER IS PART OF THE FRAME, THE SUBTITLE IS NOT ──────────────────
 *
 * `title`/`subtitle` are per-screen because the two screens answer different
 * questions. Choosing tickets, the header names the EVENT and its date and city
 * — you are still deciding, and that is the context you need. Reviewing, the
 * header names the TASK ("Review your booking") because the event is already
 * settled and is shown in full immediately below.
 *
 * ── WHY THE ORDER SUMMARY CARD IS GONE ────────────────────────────────────
 *
 * It was mounted here so it survived navigation between steps and could animate
 * its height. With two screens that both display the order in full, it was the
 * event and the total rendered twice on the same screen — and on a phone the
 * duplicate came FIRST, pushing the real content below the fold. The hold
 * countdown it carried moved to the review screen, where it belongs: nothing is
 * being held while you are still choosing.
 */
export function FunnelShell({
  event,
  initialTiers,
  slots,
  questions,
  children,
}: {
  event: EventDetail;
  initialTiers: TicketTier[];
  /** Empty for a single-show event, which is most of them. */
  slots?: EventSlot[];
  /** The organiser's questionnaire. Empty for most events. */
  questions?: EventQuestion[];
  children: React.ReactNode;
}) {
  return (
    <BookingProvider
      event={event}
      initialTiers={initialTiers}
      slots={slots ?? []}
      questions={questions ?? []}
    >
      {children}
    </BookingProvider>
  );
}

/**
 * The screen frame: a pinned header, a scrolling body, and room at the bottom
 * for the action bar that is `fixed` over it.
 */
export function FunnelScreen({
  title,
  subtitle,
  children,
  banner,
  className,
}: {
  title: string;
  /** The second line under the title. Omitted where the title stands alone. */
  subtitle?: React.ReactNode;
  /** Full-width strip directly under the header — the hold countdown. */
  banner?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {/* ── THE HEADER AND THE COUNTDOWN PIN TOGETHER ─────────────────────
          The banner used to sit OUTSIDE this wrapper, under a sticky header
          without being sticky itself — so the hold countdown left the viewport
          within one flick, and everything it is counting down over (the order,
          the total, the donation, the pay button) is below that point. A
          deadline you can scroll past is a fact you were shown once.

          One sticky wrapper rather than two stacked sticky elements with
          hand-computed offsets: the second would need to know the first's
          height, which changes with a wrapped title. */}
      {/* OPAQUE, and that is load-bearing. The header is `bg-background/95` and
          the countdown band is a 10% `--primary` tint — both translucent, and
          with nothing solid behind them the page scrolled visibly THROUGH the
          pinned block: "PAYMENT SUMMARY" read straight across the countdown's
          digits. A solid base here gives both something to composite onto, so
          the tint still reads as a tint and the text stays legible.

          It said `bg-canvas` first, which is NOT A UTILITY THIS CONFIG DEFINES
          — Tailwind drops an unknown class silently, so the header had been
          fully transparent since it was written and nothing said so. It only
          ever looked right because most of what scrolls under it is white. The
          token is `background`; `--canvas` exists in the CSS but is not mapped
          into the colour scale. */}
      <div className="sticky top-0 z-sticky bg-background">
        <FunnelHeader title={title} subtitle={subtitle} />
        {banner}
      </div>
      {/* A SECTION, not a `<main>`: the root layout owns the document's main
          landmark. The id is the skip-link target and what the step
          transitions reference. */}
      <section
        id="funnel-main"
        aria-label="Checkout"
        className={cn(
          'mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 pt-5 sm:px-6',
          // Clearance for the fixed action bar. It publishes its own measured
          // height, so this follows a two-line caption or a one-line one
          // without a magic number; the fallback covers the first paint.
          'pb-[calc(var(--sticky-action-height,5.5rem)+env(safe-area-inset-bottom)+1.5rem)]',
          className,
        )}
      >
        {children}
      </section>
    </div>
  );
}

/**
 * The back arrow, and the one place a hold can be released deliberately.
 */
function BackControl() {
  const router = useRouter();
  const { event, booking, setBooking, clearSelection } = useBooking();
  const [asking, setAsking] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);

  const live =
    booking?.status === 'reserved' &&
    Boolean(booking.hold_expires_at) &&
    Date.parse(booking.hold_expires_at as string) > Date.now();

  /**
   * ── THE HARDWARE BACK BUTTON ASKS THE SAME QUESTION ─────────────────
   *
   * The arrow above prompts before releasing a live hold. The phone's own
   * back button and the edge-swipe gesture did not: they are a history
   * navigation, not a click, so they left the checkout with the hold still
   * counting down — the customer's seats held by a booking they had walked
   * away from, until the sweeper caught it a minute later.
   *
   * A SENTINEL ENTRY is the only thing that can intercept it. There is no
   * cancellable event for a back navigation — `popstate` fires AFTER the
   * history has already moved — so the guard pushes a throwaway entry while
   * the hold is live, and the back press pops THAT instead of leaving. The
   * handler immediately pushes it again and opens the drawer, so the guard
   * survives being used and a second press asks again rather than escaping.
   *
   * Only while `live`. A checkout with no hold has nothing to confirm, and a
   * guard there would trap somebody on a screen they are entitled to leave.
   */
  React.useEffect(() => {
    if (!live) return;
    window.history.pushState({ ccHoldGuard: true }, '');
    const onPop = () => {
      window.history.pushState({ ccHoldGuard: true }, '');
      setAsking(true);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [live]);

  /**
   * ── BACK GOES TO THE EVENT PAGE, NOT WHEREVER HISTORY POINTS ──────────
   *
   * It was `router.back()`, argued for as "the browser's own history is the
   * truthful answer to where was I". It is not, inside this flow. The
   * checkout's own screens are history entries: the picker pushes the review,
   * a failed payment pushes `/failed`, the review's sign-in sheet and the
   * hold guard below push their own entries, and Razorpay hands control back
   * with entries of its own. So Back from the review landed on the screen
   * before it — another checkout screen, which immediately re-reserves and
   * offers Back again. That is the reported loop, and no number of extra
   * entries makes a relative Back mean "leave the checkout".
   *
   * The event page is the one destination that is always correct: every route
   * into this flow comes from it, and somebody who arrived on a shared
   * `/booking/{id}` link has still, by definition, chosen that event.
   *
   * `replace`, not `push`: pushing leaves the checkout one Back press away
   * from the page we just sent them to, which is the loop again with an extra
   * step.
   */
  const leave = () => {
    setAsking(false);
    clearSelection();
    router.replace(eventPath(event));
  };

  /**
   * Release the hold, and LEAVE — without waiting for the release.
   *
   * The request is fired and not awaited: a client-side navigation does not
   * abort it, so the seats go back on sale either way, and making somebody
   * watch a spinner to be told what they already decided is the one part of
   * this that was never doing any work. Failure is swallowed on purpose — a
   * 409 means the sweeper or another tab got there first, which is the
   * outcome this call wanted.
   */
  const cancelAndLeave = () => {
    if (!booking) return leave();
    setCancelling(true);
    void cancelBooking(booking.id).catch(() => undefined);
    setBooking(null);
    bumpAllAttemptsForEvent(event.id);
    setCancelling(false);
    leave();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (live) {
            setAsking(true);
          } else {
            leave();
          }
        }}
        aria-label="Go back"
        className="-ml-2 inline-flex size-9 shrink-0 items-center justify-center rounded-full text-foreground transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-5" aria-hidden />
      </button>

      <Drawer open={asking} onOpenChange={(next) => !cancelling && setAsking(next)}>
        <DrawerContent side="responsive" aria-label="Cancel this booking?">
          <div className="flex flex-col gap-block px-6 py-card-lg">
            <div className="flex flex-col gap-2">
              <DrawerTitle>Cancel this booking?</DrawerTitle>
              <DrawerDescription>
                Your tickets go back on sale straight away, so they may be gone if you come
                back. Nothing has been charged.
              </DrawerDescription>
            </div>
            {/* The SAFE action is the primary one and sits under the thumb.
                A destructive default is how somebody loses their seats to a
                mis-tap on a control they opened by accident. */}
            <div className="flex flex-col gap-2">
              <Button
                size="lg"
                className={CTA_PILL_LG}
                onClick={() => setAsking(false)}
                disabled={cancelling}
              >
                Keep my tickets
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="w-full text-destructive hover:bg-destructive-subtle hover:text-destructive-subtle-foreground"
                onClick={cancelAndLeave}
                disabled={cancelling}
              >
                {cancelling ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Releasing them
                  </>
                ) : (
                  'Cancel booking'
                )}
              </Button>
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

function FunnelHeader({ title, subtitle }: { title: string; subtitle?: React.ReactNode }) {
  return (
    // Not sticky itself — the wrapper above pins the header and the countdown
    // as one block, so they can never separate mid-scroll.
    <header className="border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-2xl items-start gap-3 px-4 py-3.5 sm:px-6">
        {/* Leaves the flow for the EVENT PAGE, explicitly — see the note in
            `BackControl`, which is also where the live hold is released and
            where the hardware back button is intercepted. */}
        <BackControl />
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-body-lg font-semibold leading-tight text-foreground">
            {title}
          </h1>
          {subtitle ? (
            <p className="truncate text-body-sm text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
      </div>
    </header>
  );
}

/** "Sun, 24 Jan, 4:00 AM | Hyderabad" — the ticket screen's subtitle. */
export function EventSubtitle({ event }: { event: EventDetail }) {
  return (
    <>
      {formatEventDate(event.starts_at)}, {formatEventTime(event.starts_at)}
      <span className="px-1.5 text-border-strong" aria-hidden>
        |
      </span>
      {event.city}
    </>
  );
}

/** The event this funnel is for — for screens that need it outside a step. */
export const useFunnelEvent = () => useBooking().event;
