'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * The two halves of progressive disclosure on the event page.
 *
 * ── WHY THIS EXISTS RATHER THAN SEVEN HAND-BUILT DIALOGS ──────────────────
 *
 * The event page had TEN stacked sections below the fold — good to know, the
 * running order, the organiser, the venue, accessibility, two sets of FAQs,
 * reviews, and two sets of policies. Every one of them was rendered at full
 * weight, all at once, which made the page a document to scroll rather than a
 * decision to make. The fix is not to delete any of it: somebody genuinely
 * needs the age limit, and somebody genuinely needs the refund rule. The fix
 * is that they do not all need it at the same moment.
 *
 * So each one collapses to a `DisclosureRow` — one line, a label, a value
 * worth reading at a glance — and opens into a `DetailSheet` holding the same
 * component that used to sit on the page. The content is UNCHANGED. Only when
 * you see it changed.
 *
 * One component, not seven, because seven would be seven sets of focus bugs
 * and seven slightly different close buttons.
 *
 * ── BOTTOM SHEET ON A PHONE, DIALOG ON A DESKTOP ──────────────────────────
 *
 * Built on Radix's Dialog, so the focus trap, the Escape key, the inert
 * background and the `aria-modal` wiring are the library's and not a
 * re-implementation. What is ours is the SHAPE, and it differs by viewport
 * because the ergonomics do: a centred dialog on a phone puts its close button
 * at the top of a tall screen, which is the one place a thumb cannot reach, so
 * below `sm` this is a bottom sheet with a grab handle. From `sm` up it is a
 * centred dialog, which is what a pointer expects.
 *
 * ── IT IS THE SHEET THAT SCROLLS, NEVER THE PAGE ──────────────────────────
 *
 * `max-h` plus a header that does not scroll and a body that does. Without
 * this the tall content (a long running order, a full policy set) either
 * overflows the viewport with its close button off-screen, or makes the sheet
 * as long as the page it was supposed to shorten.
 */

/* -------------------------------------------------------------------------- */
/* The row                                                                    */
/* -------------------------------------------------------------------------- */

export interface DisclosureRowProps {
  /**
   * A RENDERED element (`<Info />`), never a component reference (`Info`).
   *
   * `buildDisclosures` runs in a SERVER component and these rows are consumed
   * by a client one, and a function cannot cross that boundary — React rejects
   * it outright with "Functions cannot be passed directly to Client
   * Components", which surfaces as the whole event page failing to render
   * rather than as a missing icon. Sizing and colour stay here so the call
   * sites pass the bare element.
   */
  icon?: React.ReactNode;
  /** What is behind the row. Always a noun, never "click here". */
  label: string;
  /**
   * The part that earns the row its place. A row reading only "Venue details"
   * asks the reader to open it to find out whether it was worth opening; one
   * reading "Venue details / Phoenix Marketcity, Mumbai" has already answered
   * the common case and the press is for the rest.
   */
  value?: React.ReactNode;
  onClick: () => void;
}

export function DisclosureRow({ icon, label, value, onClick }: DisclosureRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      // `text-left` because a button centres its text by default and these are
      // rows of prose, not labels on a control.
      className={cn(
        'group flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3.5 text-left',
        'transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      )}
    >
      {icon ? (
        <span className="shrink-0 text-muted-foreground [&>svg]:size-5" aria-hidden>
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body font-medium text-foreground">{label}</span>
        {value ? (
          // `truncate` and not `line-clamp-2`: the row is a summary. If it
          // needs two lines it is no longer a summary and belongs in the sheet.
          <span className="truncate text-body-sm text-muted-foreground">{value}</span>
        ) : null}
      </span>
      <ChevronRight
        className="size-5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5"
        aria-hidden
      />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* The sheet                                                                  */
/* -------------------------------------------------------------------------- */

export interface DetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** One line under the title where the sheet needs framing. Optional. */
  description?: string;
  children: React.ReactNode;
  /**
   * `lg` for content that is genuinely wide (a running order with times, a
   * two-column fact grid). Everything else stays `md` — §10's "do not create
   * oversized modal dialogs" is a real failure mode, and a 900px dialog around
   * four lines of text reads as a page that opened by mistake.
   */
  size?: 'md' | 'lg';
}

export function DetailSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = 'md',
}: DetailSheetProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-modal bg-overlay/60 backdrop-blur-sm',
            'animate-in fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed z-modal flex flex-col overflow-hidden bg-elevated text-foreground shadow-xl',
            // ── PHONE: a bottom sheet ──────────────────────────────────────
            'inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border border-border',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
            // ── POINTER: a centred dialog ──────────────────────────────────
            'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl',
            'sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=open]:slide-in-from-bottom-0',
            'sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95',
            size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg',
          )}
        >
          {/* The grab handle is a bottom-sheet affordance and says "drag me".
              From `sm` this is a dialog and it would be lying, so it goes. */}
          <div
            className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-border sm:hidden"
            aria-hidden
          />

          {/* PINNED. The close control must not be able to scroll off, which
              is the failure that makes a long sheet feel like a trap. */}
          <div className="flex shrink-0 items-start gap-4 px-5 pb-4 pt-4 sm:px-6 sm:pt-6">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <DialogPrimitive.Title className="text-h4">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="text-body-sm text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close
              aria-label="Close"
              // `size-9` keeps a comfortable target without the 44px floor's
              // bulk beside a heading; it sits inside a sheet a tap already
              // opened, and Escape and the scrim are both also exits.
              className="-mr-1 -mt-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-5" aria-hidden />
            </DialogPrimitive.Close>
          </div>

          {/* THE ONLY SCROLLING REGION. `pb-8` on mobile clears the home
              indicator on a gesture-nav phone, where content flush to the
              bottom edge is both hard to read and hard to tap. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-1 sm:px-6 sm:pb-6">
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* -------------------------------------------------------------------------- */
/* Row group                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Rows read as one list rather than a stack of separate cards. On a page that
 * already carries a lifted ticket panel, six more shadowed objects is six more
 * things competing with the one that should be lifting.
 */
export function DisclosureList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('flex flex-col gap-2', className)}>{children}</div>;
}
