'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal, ModalContent, ModalDescription, ModalTitle } from '@/components/ui/modal';
import { QuestionFields } from '@/components/booking/questionnaire';
import type { EventQuestion } from '@/lib/api/event-content';
import { answersFor, setAnswer, unansweredRequired } from '@/lib/booking/answers';

/**
 * WHAT THE ORGANISER NEEDS SETTLED BEFORE THE CHECKOUT OPENS.
 *
 * ── WHY IT MOVED OFF THE PICKER ───────────────────────────────────────────
 *
 * "Are you 18+" was a field on the ticket screen, under the tiers, between a
 * price and a Checkout button. It reads there as one more thing to fill in on
 * the way to paying. It is not: it is a CONDITION OF ENTRY, and somebody who
 * cannot meet it should learn that before choosing seats rather than after.
 * So it is a modal on Book tickets, on the event page, before the flow starts.
 *
 * ── TWO THINGS, ONE MOMENT ────────────────────────────────────────────────
 *
 * 1. The event's own `age_restriction` — a real column the organiser fills in,
 *    drawn as the headline. NOT invented: an event without one shows no badge
 *    and no age sentence, because "18+" over an all-ages gig is a claim nobody
 *    made.
 * 2. The organiser's questionnaire, which is where an explicit "ARE YOU 18+"
 *    question lives, asked here so the checkout has nothing left to ask.
 *
 * With neither, there is no modal at all: the control is a plain link, and the
 * great majority of events never see this component do anything. That is why
 * it renders a `Link` rather than always a button — a link is prefetchable,
 * openable in a new tab and right-clickable, and turning every Book tickets on
 * the platform into a JavaScript button to serve a minority would be a real
 * loss on the hottest route there is.
 *
 * ── IT IS A COURTESY, NEVER THE ENFORCEMENT ───────────────────────────────
 *
 * Nothing here is trusted. `create_booking` re-validates every required answer
 * server-side and refuses the booking with the question named — which is what
 * still happens for a deep link straight to `/booking/{id}`, where this modal
 * never ran. The picker keeps its copy of whatever is still unanswered for
 * exactly that path. What this buys is the ORDER things are asked in, not the
 * guarantee.
 *
 * ── A SERVER COMPONENT'S CLIENT LEAF ──────────────────────────────────────
 *
 * `booking-cta.tsx` is a server component and must stay one — marking it
 * `'use client'` would pull the whole sticky rail, `EventDisclosures` and the
 * page's disclosure sheets into the client bundle. So the interactive part is
 * this leaf, and the caller passes its own classes in: the gate decides
 * WHETHER to ask, never what the button looks like.
 */
export function BookTicketsAction({
  eventId,
  href,
  ageRestriction = '',
  questions = [],
  className,
  children,
  ariaLabel,
  onBeforeNavigate,
}: {
  eventId: string;
  /** Where Continue goes — the caller owns the destination. */
  href: string;
  /** `Event.age_restriction`. Blank for most events, and blank draws nothing. */
  ageRestriction?: string;
  questions?: EventQuestion[];
  className?: string;
  children: React.ReactNode;
  ariaLabel?: string;
  /**
   * Run as the checkout is entered, on BOTH paths — the plain link and the
   * gate's Continue. The mobile event page uses it to close its overlay: the
   * deck's own dismiss finishes inside an animation callback that never runs
   * once the route has changed.
   */
  onBeforeNavigate?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [showErrors, setShowErrors] = React.useState(false);

  const age = ageRestriction.trim();
  const asks = Boolean(age) || questions.length > 0;

  const missing = React.useMemo(
    () => new Set(unansweredRequired(questions, answers).map((question) => question.id)),
    [questions, answers],
  );

  if (!asks) {
    return (
      <Link href={href} onClick={onBeforeNavigate} aria-label={ariaLabel} className={className}>
        {children}
      </Link>
    );
  }

  const start = () => {
    // Seeded from the store, so coming back to the event page shows what was
    // already answered rather than an empty form.
    setAnswers(answersFor(eventId));
    setShowErrors(false);
    setOpen(true);
  };

  const proceed = () => {
    if (missing.size > 0) {
      setShowErrors(true);
      return;
    }
    for (const question of questions) {
      const value = answers[question.id] ?? '';
      if (value.trim()) setAnswer(eventId, question.id, value);
    }
    setOpen(false);
    onBeforeNavigate?.();
    router.push(href);
  };

  return (
    <>
      <button type="button" onClick={start} aria-label={ariaLabel} className={className}>
        {children}
      </button>

      <Modal open={open} onOpenChange={setOpen}>
        <ModalContent
          hideClose
          aria-describedby="pre-book-gate-body"
          className="max-h-[85vh] gap-5 overflow-y-auto sm:max-w-md"
        >
          <div className="flex flex-col items-center gap-3 text-center">
            {/* ── THE TEXT CHOOSES THE SHAPE, RATHER THAN BEING FORCED INTO
                   ONE ────────────────────────────────────────────────────

                `Event.age_restriction` is FREE TEXT. "18+" and "21+" are what
                the old fixed 80px circle was designed around; "Under 18s with
                an adult" is equally real and was rendered into that same
                circle, where it wrapped to four lines, overflowed the border
                and struck through its own ring. The badge was unreadable on
                exactly the events whose rule most needs reading.

                So LENGTH picks the presentation. That is not the parsing the
                old comment rightly forbade — nothing here reasons about what
                the number MEANS, decides who may attend, or reformats the
                organiser's words. It asks one question: does this fit in a
                disc? A short token gets the crisp numeric badge; anything
                longer gets a pill that can breathe, under a warning mark that
                carries the same meaning without pretending to be a number. */}
            <AgeBadge age={age} />
            {/* "This event is 18+" reads as a sentence. "This event is Under
                18s with an adult" does not, and on the deployed site it also
                repeated the badge word for word two lines apart. A long rule
                is already shown in full by the pill above, so the heading
                names the SUBJECT and lets the rule speak once. */}
            <ModalTitle className="text-balance text-h4">
              {!age
                ? 'Before you book'
                : isShortAgeToken(age)
                  ? `This event is ${age}`
                  : 'Age restriction'}
            </ModalTitle>
            <ModalDescription id="pre-book-gate-body">
              {age
                ? 'The organiser decides who can attend. Carry photo ID — entry can be refused at the door without it, and a refused entry is not refunded.'
                : 'The organiser needs this before you book.'}
            </ModalDescription>
          </div>

          {questions.length ? (
            <div className="border-t border-border pt-4 text-left">
              <QuestionFields
                questions={questions}
                answers={answers}
                answerQuestion={(questionId, answer) =>
                  setAnswers((current) => ({ ...current, [questionId]: answer }))
                }
                missing={missing}
                showErrors={showErrors}
              />
            </div>
          ) : null}

          {/* Continue is the primary and sits under the thumb; Cancel is the
              quiet one. Nothing is held and nothing is charged by either, so
              neither is destructive — this is a question, not a warning about
              something already done. */}
          <div className="flex flex-col gap-2">
            <Button size="lg" className="w-full rounded-full" onClick={proceed}>
              Continue
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="w-full rounded-full"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </ModalContent>
      </Modal>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* The age badge                                                              */
/* -------------------------------------------------------------------------- */

/**
 * How many characters still read as a NUMBER at badge size.
 *
 * "18+", "21+" and "16+" are the tokens the disc was designed for and the ones
 * that carry at a glance. Past this the string is a sentence, and a sentence
 * inside a 5rem circle is what wrapped to four lines and struck through its own
 * border on the deployed site.
 */
const AGE_TOKEN_MAX = 5;

export function isShortAgeToken(age: string): boolean {
  return age.trim().length > 0 && age.trim().length <= AGE_TOKEN_MAX;
}

/**
 * The warning mark on the pre-book gate.
 *
 * Three states, and each is a different SHAPE rather than the same shape with
 * different text crammed in:
 *
 *   "18+"                     a crisp numeric disc — the token IS the graphic
 *   "Under 18s with an adult" a shield mark, with the rule as a pill beneath
 *   (blank)                   a neutral shield, because no claim is being made
 *
 * The ring is drawn with `ring` rather than `border` so it sits OUTSIDE the
 * box: a border eats into the 5rem the glyph has to live in, which is part of
 * how the old badge ran out of room. The soft `bg-destructive/10` disc behind
 * it is what makes this read as a deliberate badge rather than an outline with
 * text in it.
 */
export function AgeBadge({ age }: { age: string }) {
  const value = age.trim();

  if (!value) {
    return (
      <span
        aria-hidden
        className="inline-flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <ShieldAlert className="size-7" />
      </span>
    );
  }

  if (isShortAgeToken(value)) {
    return (
      <span
        aria-hidden
        className="inline-flex size-20 items-center justify-center rounded-full bg-destructive/10 text-h3 font-extrabold leading-none tracking-tight text-destructive ring-2 ring-destructive/40"
      >
        {value}
      </span>
    );
  }

  // Long-form rule: the mark carries the warning, the words carry the detail.
  // `max-w-full` + `text-balance` keep a two-line rule centred and even rather
  // than leaving one orphaned word on the second line.
  return (
    <span className="flex flex-col items-center gap-2.5">
      <span
        aria-hidden
        className="inline-flex size-16 items-center justify-center rounded-full bg-destructive/10 text-destructive ring-2 ring-destructive/40"
      >
        <ShieldAlert className="size-8" />
      </span>
      <span
        aria-hidden
        className="max-w-full text-balance rounded-full bg-destructive/10 px-4 py-1.5 text-caption font-semibold uppercase tracking-wide text-destructive"
      >
        {value}
      </span>
    </span>
  );
}
