'use client';

import * as React from 'react';
import { Input, Textarea } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { useBooking } from './booking-context';

/**
 * The organiser's questions, asked on the ticket-picker screen.
 *
 * ── WHY HERE AND NOT ON THE REVIEW SCREEN ─────────────────────────────────
 *
 * The reserve fires on MOUNT of the review screen — before anybody could read
 * a form, let alone fill one in — and the answers have to travel WITH that
 * request, because `create_booking` is the only place the required-answer rule
 * cannot be routed around. So the questions are asked one screen earlier, and
 * the answers ride in `sessionStorage` across the navigation.
 *
 * ── NOTHING IS MARKED WRONG UNTIL SOMEBODY TRIES TO LEAVE ─────────────────
 *
 * A required question is not an error the moment the screen paints; it is an
 * error when Checkout is pressed with it still empty. Painting it red on
 * arrival tells somebody they have made a mistake by turning up, which is the
 * same reason the tag matrix counts up rather than warning down.
 *
 * ── ABSENT, NOT EMPTY ─────────────────────────────────────────────────────
 *
 * Most events ask nothing, and this renders nothing at all for them — never a
 * heading over a void.
 */
export function Questionnaire({ showErrors }: { showErrors: boolean }) {
  const { questions, answers, answerQuestion, unanswered } = useBooking();
  if (!questions.length) return null;

  const missing = new Set(unanswered.map((question) => question.id));

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-card">
      <div className="flex flex-col gap-1">
        <h3 className="text-body font-semibold text-foreground">Before you book</h3>
        <p className="text-caption text-muted-foreground">
          The organiser needs this to run the event.
        </p>
      </div>

      <ul className="flex flex-col gap-4">
        {questions.map((question) => {
          const value = answers[question.id] ?? '';
          const wrong = showErrors && missing.has(question.id);
          const id = `question-${question.id}`;
          const describedBy = question.help_text ? `${id}-hint` : undefined;

          return (
            <li key={question.id} className="flex flex-col gap-1.5">
              <label htmlFor={id} className="text-body-sm font-medium text-foreground">
                {question.prompt}
                {question.is_required ? (
                  <span className="text-destructive" aria-hidden>
                    {' '}
                    *
                  </span>
                ) : (
                  <span className="font-normal text-muted-foreground"> (optional)</span>
                )}
              </label>
              {question.help_text ? (
                <p id={`${id}-hint`} className="text-caption text-muted-foreground">
                  {question.help_text}
                </p>
              ) : null}

              {question.kind === 'long_text' ? (
                <Textarea
                  id={id}
                  value={value}
                  rows={3}
                  aria-required={question.is_required}
                  aria-invalid={wrong}
                  aria-describedby={describedBy}
                  onChange={(event) => answerQuestion(question.id, event.target.value)}
                />
              ) : question.kind === 'choice' ? (
                /* A radio GROUP, not a select. The options are few and fixed,
                   and a radio set shows every answer at once — a select on a
                   phone hides them behind a tap and a scroll. */
                <div
                  role="radiogroup"
                  aria-labelledby={id}
                  aria-required={question.is_required}
                  className="flex flex-wrap gap-2"
                >
                  {question.choices.map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={value === option}
                      onClick={() => answerQuestion(question.id, option)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-body-sm transition-colors duration-fast',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        value === option
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border text-foreground hover:border-foreground/40',
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : question.kind === 'boolean' ? (
                /* Two explicit buttons rather than one checkbox: an unticked
                   box and "No" are indistinguishable, and a required yes/no
                   question needs to tell them apart. */
                <div
                  role="radiogroup"
                  aria-labelledby={id}
                  aria-required={question.is_required}
                  className="flex gap-2"
                >
                  {['Yes', 'No'].map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={value === option}
                      onClick={() => answerQuestion(question.id, option)}
                      className={cn(
                        'rounded-full border px-4 py-1.5 text-body-sm transition-colors duration-fast',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        value === option
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border text-foreground hover:border-foreground/40',
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : (
                <Input
                  id={id}
                  value={value}
                  aria-required={question.is_required}
                  aria-invalid={wrong}
                  aria-describedby={describedBy}
                  onChange={(event) => answerQuestion(question.id, event.target.value)}
                />
              )}

              {wrong ? (
                <p role="alert" className="text-caption text-destructive">
                  This one is needed before you can book.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
