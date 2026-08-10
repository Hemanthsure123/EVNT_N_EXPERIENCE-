'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HelpCircle, Plus, Trash2 } from 'lucide-react';
import { addFaq, fetchEventContent, removeFaq, type EventFaq } from '@/lib/api/event-content';
import { ApiError } from '@/lib/api/errors';
import { EmptyState, ErrorState, Skeleton } from '@/components/organizer/primitives';
import { Button, Input, Textarea } from '@/components/ui';

/**
 * The FAQ builder.
 *
 * ── EDITS GO STRAIGHT TO THE SERVER ───────────────────────────────────────
 *
 * Unlike the event's own fields, FAQs are not held in the local draft. They
 * are a collection with create/delete endpoints keyed on an event that already
 * exists, so mirroring them locally would mean inventing a reconciliation
 * ("which of these five are new?") that buys nothing — the step is only
 * reachable once the draft has saved.
 *
 * ── THERE IS NO EDIT, BECAUSE THERE IS NO PATCH ───────────────────────────
 *
 * `apps/events` exposes POST and DELETE on `/events/{id}/faqs` and nothing
 * else. Rather than fake an edit as delete-then-recreate — which silently
 * changes the id and would reorder the list under someone's cursor — a
 * correction is Remove then Add, which is what actually happens either way,
 * said out loud.
 *
 * ── THE SUGGESTIONS ARE PROMPTS, NOT CONTENT ──────────────────────────────
 *
 * The chips fill the QUESTION only. The answer is always typed, because a
 * pre-written answer is how "Yes, parking is available" ends up on an event
 * with no car park. They are prompts rather than a selection, so they never
 * wear the "you are here" pill — a suggestion that has been used simply
 * disappears from the list.
 *
 * "Add question" is an `outline` control: this composer is a repeated action
 * inside a step, not the step's forward action, which is the wizard footer's
 * one near-black pill.
 */

const SUGGESTED_QUESTIONS = [
  'Is there parking at the venue?',
  'What time should I arrive?',
  'Is there an age restriction?',
  'Can I transfer my ticket to someone else?',
  'What happens if it rains?',
  'Is food and drink available?',
  'Is the venue wheelchair accessible?',
  'What can I bring in with me?',
];

const QUESTION_MAX = 200;

export function FaqBuilder({ eventId }: { eventId: string }) {
  const client = useQueryClient();
  const [question, setQuestion] = React.useState('');
  const [answer, setAnswer] = React.useState('');
  const [failure, setFailure] = React.useState<string | null>(null);
  const questionRef = React.useRef<HTMLInputElement>(null);

  const content = useQuery({
    queryKey: ['event-content', eventId],
    queryFn: () => fetchEventContent(eventId),
  });

  const invalidate = () => client.invalidateQueries({ queryKey: ['event-content', eventId] });

  const create = useMutation({
    mutationFn: (input: Omit<EventFaq, 'id'>) => addFaq(eventId, input),
    onSuccess: () => {
      setQuestion('');
      setAnswer('');
      setFailure(null);
      void invalidate();
      // Focus back to the question so a run of five FAQs is five sequences of
      // type–tab–type–enter, never a reach for the mouse in between.
      questionRef.current?.focus();
    },
    onError: (thrown) =>
      setFailure(thrown instanceof ApiError ? thrown.message : 'Could not add that question.'),
  });

  const drop = useMutation({
    mutationFn: (faqId: string) => removeFaq(eventId, faqId),
    onSuccess: () => void invalidate(),
  });

  const faqs = content.data?.faqs ?? [];
  const ready = question.trim().length > 0 && answer.trim().length > 0;

  const submit = () => {
    if (!ready || create.isPending) return;
    create.mutate({
      question: question.trim(),
      answer: answer.trim(),
      position: faqs.length,
    });
  };

  return (
    <div className="flex flex-col gap-stack-lg">
      {content.isError ? (
        <ErrorState message="Could not load the FAQs." onRetry={() => void content.refetch()} />
      ) : content.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : faqs.length === 0 ? (
        <EmptyState
          icon={HelpCircle}
          title="No questions yet"
          body="Answers shown on the event page, under the description."
        />
      ) : (
        <ol className="flex flex-col gap-2">
          {faqs.map((faq, index) => (
            <li
              key={faq.id}
              className="flex items-start gap-3 rounded-xl border border-border bg-sunken p-stack"
            >
              <span
                className="mt-2 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-caption tabular-nums text-muted-foreground"
                aria-hidden
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 py-1.5">
                <span className="block text-body-sm font-medium">{faq.question}</span>
                <span className="block whitespace-pre-wrap text-caption text-muted-foreground">
                  {faq.answer}
                </span>
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => drop.mutate(faq.id)}
                disabled={drop.isPending}
                aria-label={`Remove “${faq.question}”`}
                className="shrink-0 hover:text-destructive"
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-col gap-stack rounded-xl border border-border bg-sunken p-card">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="faq-question" className="text-body-sm font-medium">
            Question
          </label>
          <Input
            id="faq-question"
            ref={questionRef}
            value={question}
            maxLength={QUESTION_MAX}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Is there parking at the venue?"
          />
        </div>

        <ul className="flex flex-wrap gap-1.5">
          {SUGGESTED_QUESTIONS.filter(
            (candidate) => !faqs.some((faq) => faq.question === candidate),
          ).map((candidate) => (
            <li key={candidate}>
              <button
                type="button"
                onClick={() => {
                  setQuestion(candidate);
                  questionRef.current?.focus();
                }}
                className="inline-flex h-control-sm items-center rounded-full border border-border bg-surface px-3 text-caption text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <Plus className="mr-1 size-3" aria-hidden />
                {candidate}
              </button>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="faq-answer" className="text-body-sm font-medium">
            Answer
          </label>
          <Textarea
            id="faq-answer"
            rows={3}
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            onKeyDown={(event) => {
              // ⌘/Ctrl+Enter submits, the convention everywhere a textarea is
              // part of a form. Plain Enter stays a newline — an answer is
              // prose, and eating its line breaks would be worse than a click.
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Yes — the multi-level car park on Gate 3 is free for ticket holders until midnight."
          />
        </div>

        {failure ? (
          <p role="alert" className="text-caption text-destructive">
            {failure}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-stack">
          <Button
            variant="outline"
            onClick={submit}
            disabled={!ready || create.isPending}
            loading={create.isPending}
            leftIcon={<Plus className="size-4" aria-hidden />}
          >
            {create.isPending ? 'Adding…' : 'Add question'}
          </Button>
          <p className="text-caption text-muted-foreground">
            <kbd className="rounded border border-border bg-surface px-1">⌘</kbd>
            <kbd className="ml-0.5 rounded border border-border bg-surface px-1">↵</kbd> to add
          </p>
        </div>
      </div>
    </div>
  );
}
