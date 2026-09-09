'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Plus, Trash2 } from 'lucide-react';
import {
  addQuestion,
  fetchEventQuestions,
  removeQuestion,
  updateQuestion,
  type EventQuestion,
} from '@/lib/api/event-content';
import { errorMessage } from '@/lib/api/errors';
import { EmptyState, ErrorState, Skeleton } from '@/components/organizer/primitives';
import { Button, Input } from '@/components/ui';
import { cn } from '@/lib/utils/cn';

/**
 * The attendee questionnaire — up to five questions asked at checkout.
 *
 * ── SERVER-BACKED, LIKE THE FAQs AND UNLIKE THE EVENT'S OWN FIELDS ────────
 *
 * Questions are a collection with their own endpoints keyed on an event that
 * already exists, so they are not held in the local draft. Mirroring them
 * would mean inventing a reconciliation ("which of these five are new?") that
 * buys nothing, because the section is only reachable once the draft has
 * saved.
 *
 * ── THERE *IS* AN EDIT HERE, UNLIKE THE FAQ BUILDER ───────────────────────
 *
 * That component's docstring explains it offers no edit because
 * `/events/{id}/faqs` has only POST and DELETE. Questions have a real PATCH,
 * and they NEED one: a question's id is what every `BookingAnswer` points at,
 * so delete-and-retype to fix a typo would orphan every answer already given
 * and leave the organiser's export unreadable. Correcting the prompt in place
 * is the whole reason that endpoint exists.
 *
 * ── REQUIRED IS OFF BY DEFAULT, AND THAT IS DELIBERATE ────────────────────
 *
 * A question turned required mid-sale makes every checkout on the event
 * demand an answer, including from people part-way through. Optional is the
 * safe default and the commonest question ("anything we should know?") is one
 * nobody should be forced to answer.
 */

/** Mirrors `events.QuestionKind`. */
const KINDS = [
  { value: 'short_text', label: 'Short answer', hint: 'One line — a name, a size.' },
  { value: 'long_text', label: 'Long answer', hint: 'A few sentences.' },
  { value: 'choice', label: 'Choose one', hint: 'A fixed list of options.' },
  { value: 'boolean', label: 'Yes or no', hint: 'A single tick.' },
] as const;

/** Mirrors `EventContentService.MAX_QUESTIONS`. */
const MAX_QUESTIONS = 5;

export function QuestionBuilder({ eventId }: { eventId: string }) {
  const client = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);

  const query = useQuery({
    queryKey: ['event-questions', eventId],
    queryFn: () => fetchEventQuestions(eventId),
  });
  const questions = React.useMemo(() => query.data ?? [], [query.data]);

  const refresh = () => client.invalidateQueries({ queryKey: ['event-questions', eventId] });

  const add = useMutation({
    mutationFn: (input: { prompt: string; kind: string; choices: string[] }) =>
      addQuestion(eventId, {
        prompt: input.prompt,
        kind: input.kind,
        choices: input.choices,
        position: questions.length,
      }),
    onSuccess: () => {
      setError(null);
      void refresh();
    },
    onError: (thrown: Error) => setError(errorMessage(thrown)),
  });

  const patch = useMutation({
    mutationFn: (input: { id: string; changes: Partial<EventQuestion> }) =>
      updateQuestion(eventId, input.id, input.changes),
    onSuccess: () => {
      setError(null);
      void refresh();
    },
    onError: (thrown: Error) => setError(errorMessage(thrown)),
  });

  const drop = useMutation({
    mutationFn: (id: string) => removeQuestion(eventId, id),
    onSuccess: () => {
      setError(null);
      void refresh();
    },
    onError: (thrown: Error) => setError(errorMessage(thrown)),
  });

  if (query.isPending) return <Skeleton className="h-40 w-full" />;
  if (query.isError) {
    return (
      <ErrorState message="Could not load your questions." onRetry={() => void query.refetch()} />
    );
  }

  const full = questions.length >= MAX_QUESTIONS;

  return (
    <div className="flex flex-col gap-stack">
      {questions.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No questions yet"
          body="Ask for anything you need before somebody turns up — dietary requirements, a T-shirt size, whether they have played before. Most events ask none."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {questions.map((question) => (
            <li key={question.id}>
              <QuestionRow
                question={question}
                onChange={(changes) => patch.mutate({ id: question.id, changes })}
                onRemove={() => drop.mutate(question.id)}
                busy={patch.isPending || drop.isPending}
              />
            </li>
          ))}
        </ul>
      )}

      {full ? (
        <p className="text-caption text-muted-foreground">
          That is the maximum ({MAX_QUESTIONS}). A checkout that asks more is one people leave.
        </p>
      ) : (
        <QuestionComposer onAdd={(input) => add.mutate(input)} busy={add.isPending} />
      )}

      {error ? (
        <p role="alert" className="text-caption text-muted-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function QuestionRow({
  question,
  onChange,
  onRemove,
  busy,
}: {
  question: EventQuestion;
  onChange: (changes: Partial<EventQuestion>) => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const [prompt, setPrompt] = React.useState(question.prompt);
  // Re-seeded when the row changes underneath — a refetch after somebody
  // else's edit must not leave a stale draft in the box.
  React.useEffect(() => setPrompt(question.prompt), [question.id, question.prompt]);

  const kind = KINDS.find((candidate) => candidate.value === question.kind);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-card">
      <div className="flex items-start gap-2">
        <Input
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          // Committed on BLUR, not per keystroke: this is a server write, and
          // a PATCH per character is a write storm on somebody's event.
          onBlur={() => {
            const next = prompt.trim();
            if (next && next !== question.prompt) onChange({ prompt: next });
            else setPrompt(question.prompt);
          }}
          aria-label="Question"
          className="flex-1"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          disabled={busy}
          aria-label={`Remove “${question.prompt}”`}
          className="shrink-0 text-destructive hover:text-destructive"
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-muted px-2.5 py-1 text-caption text-muted-foreground">
          {kind?.label ?? question.kind}
        </span>
        {question.choices.length ? (
          <span className="text-caption text-muted-foreground">{question.choices.join(' · ')}</span>
        ) : null}
        <label className="ml-auto flex items-center gap-2 text-caption">
          <input
            type="checkbox"
            checked={question.is_required}
            onChange={(event) => onChange({ is_required: event.target.checked })}
            disabled={busy}
            className="size-4 rounded border-border accent-foreground"
          />
          <span>Required</span>
        </label>
      </div>
    </div>
  );
}

function QuestionComposer({
  onAdd,
  busy,
}: {
  onAdd: (input: { prompt: string; kind: string; choices: string[] }) => void;
  busy: boolean;
}) {
  const [prompt, setPrompt] = React.useState('');
  const [kind, setKind] = React.useState<string>('short_text');
  const [options, setOptions] = React.useState('');

  const needsOptions = kind === 'choice';
  // Mirrors the server's rule: one option is not a choice. Checked here so the
  // composer says so before the round trip, not instead of it.
  const parsed = options
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean);
  const ready = prompt.trim().length > 0 && (!needsOptions || parsed.length >= 2);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-card">
      <Input
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="Any dietary requirements?"
        aria-label="New question"
      />

      <div className="flex flex-wrap gap-2">
        {KINDS.map((candidate) => (
          <button
            key={candidate.value}
            type="button"
            onClick={() => setKind(candidate.value)}
            aria-pressed={kind === candidate.value}
            title={candidate.hint}
            className={cn(
              'rounded-full border px-3 py-1.5 text-caption transition-colors duration-fast',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              kind === candidate.value
                ? 'border-foreground bg-foreground text-background'
                : 'border-border text-muted-foreground hover:border-foreground/40',
            )}
          >
            {candidate.label}
          </button>
        ))}
      </div>

      {needsOptions ? (
        <div className="flex flex-col gap-1">
          <Input
            value={options}
            onChange={(event) => setOptions(event.target.value)}
            placeholder="Small, Medium, Large"
            aria-label="Options, separated by commas"
          />
          <p className="text-caption text-muted-foreground">
            Separate the options with commas. At least two — one option is not a choice.
          </p>
        </div>
      ) : null}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!ready || busy}
        onClick={() => {
          onAdd({ prompt: prompt.trim(), kind, choices: parsed });
          setPrompt('');
          setOptions('');
        }}
        className="w-fit gap-1.5"
      >
        <Plus className="size-4" aria-hidden />
        Add question
      </Button>
    </div>
  );
}
