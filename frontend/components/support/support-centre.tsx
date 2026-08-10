'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageSquare, Plus, Send } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth/auth-provider';
import { ApiError } from '@/lib/api/errors';
import {
  SUPPORT_STATUS_LABELS,
  fetchMySupportQueries,
  fetchSupportQuery,
  raiseSupportQuery,
  replyToSupportQuery,
  type SupportAudience,
  type SupportQuery,
} from '@/lib/api/support';
import { EmptyState, ErrorState, Skeleton, StatusPill } from '@/components/organizer/primitives';
import { cn } from '@/lib/utils/cn';

/**
 * Support: ask a person, and read what they said back.
 *
 * ── WHY THIS REPLACED AN EMAIL ADDRESS ────────────────────────────────────
 *
 * Everything else on this platform is a row somebody can look at — a booking, a
 * refund request, a payout attempt. Support was a `mailto:`, so a customer had
 * no way to see whether anyone had read their message and an operator had no
 * way to know what was outstanding. "Can't scan it?" on a ticket, at a gate,
 * opened a mail client.
 *
 * ── THE FORM ASKS WHO IT IS FOR, AND THAT IS NOT A DETAIL ─────────────────
 *
 * The organiser is standing at the gate; the platform holds the payment
 * record. Sending a refund dispute to a venue, or a door problem to a support
 * desk in another city, wastes the one thing somebody in trouble does not have.
 *
 * They choose rather than us inferring it from their words. Arriving from a
 * ticket preselects "Both", which is the honest default when the person cannot
 * yet know whose problem it is.
 *
 * ── ONE SCREEN, NOT A TICKETING SYSTEM ────────────────────────────────────
 *
 * A list of threads on the left, the open one on the right. No priorities, no
 * categories, no SLA badge: none of those are recorded, and a status nobody
 * maintains is worse than none.
 */

const AUDIENCES: { value: SupportAudience; label: string; hint: string }[] = [
  {
    value: 'organizer',
    label: 'The organiser',
    hint: 'Entry, the venue, the running order — they are the ones there.',
  },
  {
    value: 'platform',
    label: 'Curatix support',
    hint: 'Payments, refunds, your account.',
  },
  { value: 'both', label: 'Not sure', hint: 'Send it to both and we will sort it out.' },
];

export function SupportCentre() {
  const params = useSearchParams();
  const ticketId = params?.get('ticket') ?? null;
  const { status } = useAuth();

  const [openId, setOpenId] = React.useState<string | null>(null);

  const list = useQuery({
    queryKey: ['support', 'mine'],
    queryFn: () => fetchMySupportQueries(),
    enabled: status === 'authenticated',
  });

  if (status === 'anonymous') {
    return (
      <div className="rounded-xl border border-border bg-surface p-card-lg shadow-sm">
        <EmptyState
          icon={MessageSquare}
          title="Sign in to get help"
          body="A query is tied to your account, so we can see your bookings and reply to you."
          action={
            <Link
              href="/sign-in?next=/support"
              className="inline-flex h-control items-center rounded-full bg-cta px-pill text-label text-cta-foreground"
            >
              Sign in
            </Link>
          }
        />
      </div>
    );
  }

  const rows = list.data?.data ?? [];

  return (
    /* ── AN INBOX, NOT A FORM BESIDE A VOID ──────────────────────────────
       The raise form used to be a permanent left rail with the thread panel
       beside it, so the page opened as a tall form next to a large empty box
       reading "Pick a query" — the biggest element on the screen was an
       instruction to do something there was nothing to do.

       This is the shape every mail client and help desk settled on: the list
       is the rail, the content area holds one thing at a time, and COMPOSING
       is one of the things it holds. Nothing on the page is ever empty, and
       the form gets the width a paragraph of prose actually wants.

       `lg:items-start` matters: without it the grid stretches both columns to
       the tallest, which is what put a card border around 400px of nothing. */
    <div className="grid gap-block-lg lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start lg:gap-block-lg">
      <div className="flex flex-col gap-stack">
        <section className="flex flex-col gap-stack" aria-label="Your queries">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-body font-semibold text-foreground">Your queries</h2>
            {/* Present only when a thread is open, because otherwise the
                content area IS the new-query form and this would point at
                what is already on screen. */}
            {openId !== null ? (
              <button
                type="button"
                onClick={() => setOpenId(null)}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-caption text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="size-3.5" aria-hidden />
                New
              </button>
            ) : null}
          </div>
          {list.isPending ? (
            <Skeleton className="h-24 w-full rounded-xl" />
          ) : list.isError ? (
            <ErrorState message="Could not load your queries." onRetry={() => void list.refetch()} />
          ) : rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-card text-caption text-muted-foreground">
              Nothing yet. Anything you ask will appear here.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(row.id)}
                    aria-current={openId === row.id}
                    className={cn(
                      'flex w-full flex-col gap-1.5 rounded-xl border p-card text-left transition-colors duration-fast',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      openId === row.id
                        ? 'border-primary bg-primary-subtle'
                        : 'border-border bg-surface hover:bg-muted',
                    )}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate text-body-sm font-medium text-foreground">
                        {row.subject}
                      </span>
                      <StatusPill tone={SUPPORT_STATUS_LABELS[row.status].tone}>
                        {SUPPORT_STATUS_LABELS[row.status].label}
                      </StatusPill>
                    </span>
                    {row.event_title ? (
                      <span className="truncate text-caption text-muted-foreground">
                        {row.event_title}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* One thing at a time in the content area: the open conversation, or
          the form to start one. */}
      {openId === null ? (
        <RaiseForm ticketId={ticketId} onRaised={(query) => setOpenId(query.id)} />
      ) : (
        <Thread id={openId} />
      )}
    </div>
  );
}

function RaiseForm({
  ticketId,
  onRaised,
}: {
  ticketId: string | null;
  onRaised: (query: SupportQuery) => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const [subject, setSubject] = React.useState('');
  const [body, setBody] = React.useState('');
  // Arriving from a ticket preselects "Not sure": somebody whose code would not
  // scan cannot know yet whether that is the gate's problem or ours.
  const [audience, setAudience] = React.useState<SupportAudience>(ticketId ? 'both' : 'platform');

  const mutation = useMutation({
    mutationFn: () => raiseSupportQuery({ subject, body, audience, ticketId }),
    onSuccess: (query) => {
      void client.invalidateQueries({ queryKey: ['support', 'mine'] });
      setSubject('');
      setBody('');
      onRaised(query);
      toast.toast({
        title: 'Query sent',
        description: 'You will get an email when somebody replies.',
        variant: 'success',
      });
    },
    onError: (error: unknown) =>
      toast.toast({
        title: 'Not sent',
        description:
          error instanceof ApiError ? error.message : 'Could not send that. Please try again.',
        variant: 'destructive',
      }),
  });

  const ready = subject.trim().length > 2 && body.trim().length > 4;

  return (
    <section
      aria-label="Raise a query"
      className="flex flex-col gap-stack rounded-xl border border-border bg-surface p-card shadow-sm"
    >
      <h2 className="text-body font-semibold text-foreground">Raise a query</h2>
      {ticketId ? (
        <p className="rounded-lg bg-sunken p-3 text-caption text-muted-foreground">
          This is attached to your ticket, so whoever picks it up can see which one.
        </p>
      ) : null}

      <label className="flex flex-col gap-1.5 text-label text-foreground" htmlFor="support-subject">
        Subject
        <Input
          id="support-subject"
          value={subject}
          maxLength={140}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="My code would not scan at the gate"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-label text-foreground" htmlFor="support-body">
        What happened
        <Textarea
          id="support-body"
          rows={4}
          value={body}
          maxLength={4000}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Tell us what you saw, and what you expected."
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="pb-1 text-label text-foreground">Who is this for?</legend>
        {AUDIENCES.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors duration-fast',
              audience === option.value
                ? 'border-primary bg-primary-subtle'
                : 'border-border hover:bg-muted',
            )}
          >
            <input
              type="radio"
              name="support-audience"
              value={option.value}
              checked={audience === option.value}
              onChange={() => setAudience(option.value)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span className="min-w-0">
              <span className="block text-body-sm font-medium text-foreground">{option.label}</span>
              <span className="block text-caption text-muted-foreground">{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <button
        type="button"
        disabled={!ready || mutation.isPending}
        onClick={() => mutation.mutate()}
        className="inline-flex h-control items-center justify-center gap-2 rounded-full bg-cta px-pill text-label text-cta-foreground shadow-sm transition-colors hover:bg-cta-hover disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        {mutation.isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Send className="size-4" aria-hidden />
        )}
        Send
      </button>
    </section>
  );
}

function Thread({ id }: { id: string | null }) {
  const client = useQueryClient();
  const [reply, setReply] = React.useState('');

  const thread = useQuery({
    queryKey: ['support', 'thread', id],
    queryFn: () => fetchSupportQuery(id as string),
    enabled: Boolean(id),
  });

  const send = useMutation({
    mutationFn: () => replyToSupportQuery(id as string, reply),
    onSuccess: () => {
      setReply('');
      void client.invalidateQueries({ queryKey: ['support', 'thread', id] });
      void client.invalidateQueries({ queryKey: ['support', 'mine'] });
    },
  });

  if (!id) {
    return (
      <div className="rounded-xl border border-dashed border-border p-card-lg">
        <EmptyState
          icon={MessageSquare}
          title="Pick a query"
          body="Open one on the left to read the conversation."
        />
      </div>
    );
  }

  if (thread.isPending) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (thread.isError || !thread.data) {
    return <ErrorState message="Could not load that query." onRetry={() => void thread.refetch()} />;
  }

  const query = thread.data;
  const state = SUPPORT_STATUS_LABELS[query.status];
  const closed = query.status === 'closed';

  return (
    <section
      aria-label={query.subject}
      className="flex flex-col gap-block rounded-xl border border-border bg-surface p-card shadow-sm lg:p-card-lg"
    >
      <header className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-h4">{query.subject}</h2>
          <StatusPill tone={state.tone}>{state.label}</StatusPill>
        </div>
        <p className="text-caption text-muted-foreground">{state.hint}</p>
      </header>

      <ol className="flex flex-col gap-3">
        <Message author="You" body={query.body} at={query.created_at} mine />
        {query.replies.map((entry) => (
          <Message
            key={entry.id}
            author={entry.is_staff_reply ? entry.author_name : 'You'}
            body={entry.body}
            at={entry.created_at}
            mine={!entry.is_staff_reply}
          />
        ))}
      </ol>

      {closed ? (
        <p className="text-caption text-muted-foreground">
          This query is closed. Raise a new one and we will pick it up.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="sr-only" htmlFor="support-reply">
            Add a reply
          </label>
          <Textarea
            id="support-reply"
            rows={3}
            value={reply}
            maxLength={4000}
            onChange={(event) => setReply(event.target.value)}
            placeholder="Add anything that would help."
          />
          <button
            type="button"
            disabled={reply.trim().length < 2 || send.isPending}
            onClick={() => send.mutate()}
            className="inline-flex h-control w-fit items-center gap-2 rounded-full bg-cta px-pill text-label text-cta-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {send.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Reply
          </button>
        </div>
      )}
    </section>
  );
}

function Message({
  author,
  body,
  at,
  mine,
}: {
  author: string;
  body: string;
  at: string;
  mine: boolean;
}) {
  return (
    <li
      className={cn(
        'flex flex-col gap-1 rounded-xl border p-card',
        mine ? 'border-border bg-sunken' : 'border-primary-subtle bg-primary-subtle',
      )}
    >
      <p className="flex items-baseline justify-between gap-3 text-caption">
        <span className="font-medium text-foreground">{author}</span>
        <time className="text-foreground-subtle" dateTime={at}>
          {new Date(at).toLocaleString('en-IN', {
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit',
          })}
        </time>
      </p>
      <p className="whitespace-pre-wrap text-body-sm text-foreground">{body}</p>
    </li>
  );
}
