'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { CalendarDays, Check, MapPin, Search, Send, Users, Wallet, X } from 'lucide-react';
import {
  OCCASION_LABELS,
  submitQuote,
  type OpenRequest,
  type Occasion,
} from '@/lib/api/performers';
import { ApiError } from '@/lib/api/errors';
import { formatMoney } from '@/lib/discovery/format';
import { parseDayLocal, useAct, useInvalidatePerformer, usePipeline } from '@/lib/performer/studio';
import { ErrorState, Skeleton } from '@/components/organizer/primitives';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { SceneNoResults, SceneNothingYet } from '@/components/illustrations/scenes';

/**
 * The leads inbox.
 *
 * ── A LEAD IS A JOB, NOT A CONTACT ────────────────────────────────────────
 *
 * The payload carries the brief and nothing identifying the customer — that is
 * enforced server-side, and it is the right call: the customer's details are
 * not the performer's to have until they are hired. So the card sells the JOB
 * (what, where, when, how much) and the only action is to answer it.
 *
 * ── SORTED BY WHAT MAKES A LEAD URGENT ────────────────────────────────────
 *
 * The server returns soonest-event-first, and that ordering IS the urgency: a
 * brief for next week is worth more than one for next year, because the
 * customer is deciding sooner. There is no response deadline on the model —
 * BACKLOG "Lead response deadline" — so the event date is the honest signal,
 * and the card says how far away it is rather than inventing an SLA.
 *
 * ── DECLINE AND ARCHIVE ARE NOT HERE ──────────────────────────────────────
 *
 * The brief asked for both. Neither has an endpoint, and neither has anywhere
 * to store the fact: not quoting IS how a performer passes on a brief, and the
 * lead simply drops off when the customer books somebody. A Decline button
 * that only hid the row locally would be a preference lost on the next device.
 * BACKLOG "Dismissable leads".
 *
 * ── SEARCH AND FILTERS ARE OVER THE LOADED PAGE, AND SAY SO ───────────────
 *
 * The leads endpoint takes no `q`. These are small per-act lists, so matching
 * here is right — but the count says "in the briefs loaded" rather than
 * implying it searched everything.
 *
 * ── ONE FILLED ACTION, AND IT IS THE ONLY ACTION ──────────────────────────
 *
 * The toolbar carries no filled button at all — a search field, chips and a
 * count. The single near-black pill on this screen is "Send a quote", repeated
 * once per brief because each card is one job with exactly one thing to do
 * with it. An applied occasion filter wears the butter `--nav-active` pill,
 * the same "you are here" colour as the active section in the sidebar.
 */
export function LeadsInbox({ performerId }: { performerId: string }) {
  const act = useAct(performerId);
  const { pipeline, isPending, isError, refetch } = usePipeline(performerId);
  const [term, setTerm] = React.useState('');
  const [occasion, setOccasion] = React.useState<Occasion | ''>('');
  const [quoting, setQuoting] = React.useState<OpenRequest | null>(null);

  const needle = term.trim().toLowerCase();
  const leads = pipeline.leads.filter((lead) => {
    if (occasion && lead.occasion !== occasion) return false;
    if (!needle) return true;
    return (
      lead.city.toLowerCase().includes(needle) ||
      lead.notes.toLowerCase().includes(needle) ||
      (OCCASION_LABELS[lead.occasion] ?? '').toLowerCase().includes(needle)
    );
  });

  const occasions = Array.from(new Set(pipeline.leads.map((lead) => lead.occasion)));
  const notLive = act.data && act.data.status !== 'live';

  return (
    <div className="flex flex-col gap-block">
      <header className="flex flex-col gap-1">
        <h1 className="text-h2">Leads</h1>
        <p className="text-body-sm text-muted-foreground">
          Briefs from customers whose act, city and budget match yours. Answer with a quote and they
          compare you against everyone else who did.
        </p>
      </header>

      {/* A quote from a profile that is not live is refused server-side, so the
          reason is given up front rather than discovered from a red banner. */}
      {notLive ? (
        <p className="rounded-xl border border-warning-subtle bg-warning-subtle p-card text-body-sm text-warning-subtle-foreground">
          Your profile is not live, so you cannot send quotes yet. Briefs still arrive — they will
          be here when it is approved.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <label htmlFor="lead-search" className="sr-only">
            Search briefs
          </label>
          {/* Violet on the leading icon — the wayfinding accent's job now that
              it is no longer a button fill. */}
          <Search
            className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-primary"
            aria-hidden
          />
          <input
            id="lead-search"
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="City, occasion or notes"
            className="h-control w-full rounded-full border border-input bg-background pl-11 pr-pill text-body-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {occasions.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={!occasion} onClick={() => setOccasion('')}>
              All
            </FilterChip>
            {occasions.map((value) => (
              <FilterChip
                key={value}
                active={occasion === value}
                onClick={() => setOccasion(occasion === value ? '' : value)}
              >
                {OCCASION_LABELS[value] ?? value}
              </FilterChip>
            ))}
          </div>
        ) : null}

        <p role="status" className="ml-auto text-caption tabular-nums text-muted-foreground">
          {isPending
            ? 'Loading…'
            : `${leads.length} of ${pipeline.leads.length} brief${pipeline.leads.length === 1 ? '' : 's'} loaded`}
        </p>
      </div>

      {isError ? (
        <ErrorState
          message="Could not load your leads."
          onRetry={refetch}
          className="rounded-xl border border-border bg-surface"
        />
      ) : isPending ? (
        <div className="flex flex-col gap-stack">
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-36 w-full rounded-xl" />
        </div>
      ) : leads.length === 0 ? (
        <div className="flex flex-col items-center gap-stack rounded-xl border border-dashed border-border px-card py-section text-center">
          {/* Two different situations, two different pictures. A filter that
              matched nothing is a SEARCH that failed; an empty inbox is a list
              waiting to be filled. Drawing one mark for both is how an act
              owner reads "nobody wants you" into what is actually "clear the
              filter". */}
          {pipeline.leads.length ? (
            <SceneNoResults className="h-24 w-auto sm:h-28" />
          ) : (
            <SceneNothingYet className="h-24 w-auto sm:h-28" />
          )}
          <p className="text-body font-medium">
            {pipeline.leads.length ? 'Nothing matches that' : 'No briefs waiting'}
          </p>
          <p className="max-w-md text-body-sm text-muted-foreground">
            {pipeline.leads.length
              ? 'Clear the search or the occasion filter to see the rest.'
              : act.data?.status === 'live'
                ? 'A brief reaches you when a customer asks for your kind of act, in your city, with a budget that reaches your starting price. Widening your travel radius or lowering your starting price brings more through.'
                : 'Briefs reach you once your profile is approved and listed.'}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-stack">
          {leads.map((lead) => (
            <li key={lead.id}>
              <LeadCard
                lead={lead}
                canQuote={act.data?.status === 'live'}
                onQuote={() => setQuoting(lead)}
              />
            </li>
          ))}
        </ul>
      )}

      {quoting ? (
        <QuoteComposer
          performerId={performerId}
          lead={quoting}
          suggestedMinor={act.data?.base_price_minor ?? null}
          onClose={() => setQuoting(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * An applied filter, in the butter "you are here" pill.
 *
 * `h-control-sm` (36px) rather than the 44px control floor: six occasion chips
 * at 44px would push the first brief off a 390px screen, and a chip is a
 * secondary refinement sitting beside a full-height search field. The real
 * buttons on this screen are all 44px.
 */
function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-control-sm items-center rounded-full border px-3 text-caption transition-colors duration-fast',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
        active
          ? 'border-nav-active bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
          : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function LeadCard({
  lead,
  canQuote,
  onQuote,
}: {
  lead: OpenRequest;
  canQuote: boolean;
  onQuote: () => void;
}) {
  const date = parseDayLocal(lead.event_date);
  const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);

  return (
    <div className="flex flex-col gap-stack-lg rounded-xl border border-border bg-surface p-card shadow-sm transition-colors duration-fast hover:border-border-strong motion-reduce:transition-none">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-body font-semibold capitalize">
            {OCCASION_LABELS[lead.occasion] ?? lead.occasion} in {lead.city}
          </h3>
          <p className="mt-0.5 text-caption text-muted-foreground">
            {days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`} ·{' '}
            {date.toLocaleDateString('en-IN', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </p>
        </div>

        {/* How many others have answered. It is the single most useful number
            on the card — it tells a performer how much competition they are
            walking into before spending time on a quote. */}
        <span
          className={cn(
            'shrink-0 rounded-full px-2.5 py-1 text-caption',
            lead.quote_count === 0
              ? 'bg-success-subtle text-success-subtle-foreground'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {lead.quote_count === 0
            ? 'Be the first to quote'
            : `${lead.quote_count} quote${lead.quote_count === 1 ? '' : 's'} so far`}
        </span>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        <Fact
          icon={Wallet}
          label="Budget"
          value={`${formatMoney(lead.budget_min_minor)} – ${formatMoney(lead.budget_max_minor)}`}
          numeric
        />
        <Fact icon={MapPin} label="Where" value={lead.city} />
        {lead.guests ? (
          <Fact icon={Users} label="Guests" value={String(lead.guests)} numeric />
        ) : (
          <Fact icon={CalendarDays} label="Date" value={date.toLocaleDateString('en-IN')} numeric />
        )}
      </dl>

      {lead.notes ? (
        // `bg-sunken`, not `bg-muted`: this is a well recessed INSIDE a
        // surface card, which is the one downward value step light theme has.
        <p className="whitespace-pre-line rounded-xl bg-sunken p-stack-lg text-body-sm text-muted-foreground">
          {lead.notes}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {/* Full 44px: this is the one thing anybody came to this screen to do,
            and it is tapped on a phone between other jobs. */}
        <Button
          onClick={onQuote}
          disabled={!canQuote}
          leftIcon={<Send className="size-3.5" aria-hidden />}
        >
          Send a quote
        </Button>
        {/* Said plainly rather than shown as a disabled Decline button that
            would store nothing. */}
        <p className="text-caption text-muted-foreground">
          Not for you? Just skip it — the brief closes when the customer books.
        </p>
      </div>
    </div>
  );
}

function Fact({
  icon: Icon,
  label,
  value,
  numeric,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  /** Money, counts and dates get lining figures so a column of them lines up. */
  numeric?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-caption uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3 shrink-0" aria-hidden />
        {label}
      </dt>
      <dd className={cn('truncate text-body-sm', numeric && 'tabular-nums')}>{value}</dd>
    </div>
  );
}

/**
 * The quote composer.
 *
 * ── ONE PRICE AND ONE MESSAGE, BECAUSE THAT IS THE MODEL ──────────────────
 *
 * `Quote` stores `amount_minor` and `message`. The brief asked for separate
 * fields for what is included, terms, estimated duration, travel and taxes —
 * none of which exists. Rather than five inputs that silently concatenate into
 * one column (and so cannot be edited, filtered or shown separately later),
 * this offers PROMPTS that help write one good message, and says so. The
 * distinction matters: a structured field can be rendered as a table on the
 * customer's side; a paragraph cannot, and pretending otherwise builds a
 * migration nobody can run. BACKLOG "Structured quote line items".
 *
 * ── THE PREVIEW IS WHAT THE CUSTOMER ACTUALLY SEES ────────────────────────
 *
 * Same shape as the customer's quote row, so there is no surprise between
 * sending and being read.
 *
 * ── SENDING IS FINAL, AND SAYS SO ─────────────────────────────────────────
 *
 * There is one quote per performer per request, enforced by the database, and
 * no endpoint to edit one. Withdrawing does NOT free the slot — the row still
 * exists — so a withdrawn quote cannot be replaced. That is a real limitation
 * and the composer states it before the click rather than after. BACKLOG
 * "Quote revisions and counter-offers".
 */
function QuoteComposer({
  performerId,
  lead,
  suggestedMinor,
  onClose,
}: {
  performerId: string;
  lead: OpenRequest;
  suggestedMinor: number | null;
  onClose: () => void;
}) {
  const invalidate = useInvalidatePerformer();
  const [rupees, setRupees] = React.useState(
    suggestedMinor ? String(Math.round(suggestedMinor / 100)) : '',
  );
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);
  const dialogRef = React.useRef<HTMLDivElement>(null);

  const send = useMutation({
    mutationFn: () =>
      submitQuote(lead.id, {
        performer_id: performerId,
        amount_minor: Math.round(Number(rupees) * 100),
        message: message.trim(),
      }),
    onSuccess: () => {
      setSent(true);
      invalidate();
    },
    onError: (thrown) =>
      setError(thrown instanceof ApiError ? thrown.message : 'Could not send that quote.'),
  });

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    dialogRef.current?.focus({ preventScroll: true });
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const amount = Math.round(Number(rupees) * 100);
  const valid = rupees !== '' && Number.isFinite(amount) && amount > 0;
  // Not a rule, a warning: the customer set the range, and a quote outside it
  // is allowed but much less likely to win.
  const outsideBudget = valid && (amount < lead.budget_min_minor || amount > lead.budget_max_minor);

  return (
    <div
      className="fixed inset-0 z-modal flex items-end justify-center bg-overlay/70 p-0 animate-in fade-in-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Send a quote"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'flex max-h-[92dvh] w-full max-w-lg flex-col overflow-y-auto bg-surface shadow-xl outline-none',
          // A bottom sheet on a phone, a centred dialog above it. Modals keep
          // the 2xl radius; cards sit one rung down at xl.
          'rounded-t-2xl sm:rounded-2xl',
          'animate-in slide-in-from-bottom-4 motion-reduce:animate-none sm:zoom-in-95',
        )}
      >
        {sent ? (
          <div className="flex flex-col items-center gap-stack p-card-lg text-center">
            <span
              className="inline-flex size-12 items-center justify-center rounded-full bg-success-subtle"
              aria-hidden
            >
              <Check className="size-6 text-success-subtle-foreground" />
            </span>
            <h2 className="text-h4">Quote sent</h2>
            <p className="max-w-sm text-body-sm text-muted-foreground">
              The customer sees it alongside every other quote on this brief, cheapest first. You
              will know the moment they decide.
            </p>
            <Button onClick={onClose} className="mt-2">
              Back to leads
            </Button>
          </div>
        ) : (
          <>
            <header className="flex items-start gap-3 border-b border-border p-card">
              <div className="min-w-0 flex-1">
                <h2 className="text-h4 capitalize">
                  Quote for a {OCCASION_LABELS[lead.occasion] ?? lead.occasion} in {lead.city}
                </h2>
                <p className="mt-0.5 text-caption text-muted-foreground">
                  {parseDayLocal(lead.event_date).toLocaleDateString('en-IN', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}{' '}
                  · their budget {formatMoney(lead.budget_min_minor)} –{' '}
                  {formatMoney(lead.budget_max_minor)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" aria-hidden />
              </Button>
            </header>

            <div className="flex flex-col gap-block p-card">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="quote-amount" className="text-body-sm font-medium">
                  Your price
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-h4 text-muted-foreground">₹</span>
                  <input
                    id="quote-amount"
                    inputMode="numeric"
                    autoFocus
                    value={rupees}
                    onChange={(event) => setRupees(event.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="80000"
                    className="h-control-lg min-w-0 flex-1 rounded-full border border-input bg-sunken px-pill text-h4 tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                {outsideBudget ? (
                  <p className="text-caption text-warning-subtle-foreground">
                    Outside their stated budget. You can still send it — some customers stretch for
                    the right act — but say why it is worth it.
                  </p>
                ) : (
                  <p className="text-caption text-muted-foreground">
                    All in, for this event. The customer compares quotes on this number.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="quote-message" className="text-body-sm font-medium">
                  Your message
                </label>
                <textarea
                  id="quote-message"
                  rows={6}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder={
                    'What they get for this price — how long you play, how many of you, what you bring.\n\nAnything you need from them — a stage, power, parking.\n\nWhen you need an answer, and what a deposit looks like.'
                  }
                  className="rounded-xl border border-input bg-sunken px-3 py-2.5 text-body-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {/* Prompts, not fields. Said plainly so nobody expects a
                    structured breakdown on the customer's side. */}
                <p className="text-caption text-muted-foreground">
                  One message, in your own words — there are no separate fields for inclusions or
                  terms yet, so cover them here.
                </p>
              </div>

              {valid ? (
                <div className="flex flex-col gap-2">
                  <p className="text-caption uppercase tracking-wide text-muted-foreground">
                    What the customer sees
                  </p>
                  <div className="rounded-xl border border-border bg-sunken p-card">
                    <p className="text-h4 tabular-nums">{formatMoney(amount)}</p>
                    {message.trim() ? (
                      <p className="mt-1 whitespace-pre-line text-body-sm text-muted-foreground">
                        {message.trim()}
                      </p>
                    ) : (
                      <p className="mt-1 text-body-sm italic text-muted-foreground">
                        No message. A price on its own wins far less often than a price with a
                        sentence.
                      </p>
                    )}
                  </div>
                </div>
              ) : null}

              {error ? (
                <p role="alert" className="text-body-sm text-destructive">
                  {error}
                </p>
              ) : null}

              <div className="flex flex-col gap-2 border-t border-border pt-4">
                {/* The limitation, before the click rather than after. */}
                <p className="text-caption text-muted-foreground">
                  You get one quote per brief and it cannot be edited afterwards, so check the
                  number before sending.
                </p>
                <div className="flex flex-wrap gap-2">
                  {/* One filled pill in this footer; Cancel is a ghost so the
                      commit is unmistakably the action being offered. */}
                  <Button
                    disabled={!valid || send.isPending}
                    loading={send.isPending}
                    leftIcon={<Send className="size-4" aria-hidden />}
                    onClick={() => {
                      setError(null);
                      send.mutate();
                    }}
                  >
                    Send this quote
                  </Button>
                  <Button variant="ghost" onClick={onClose}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
