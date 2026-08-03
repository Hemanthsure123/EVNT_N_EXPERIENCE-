'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import {
  OCCASION_LABELS,
  PERFORMER_TYPE_LABELS,
  createBookingRequest,
  type Occasion,
  type PerformerType,
} from '@/lib/api/performers';
import { ApiError } from '@/lib/api/errors';
import { SpotHireABand } from '@/components/illustrations/spots';
import { useAuth } from '@/lib/auth/auth-provider';
import { POPULAR_CITIES } from '@/lib/discovery/cities';
import { PerformerArt } from './performer-art';
import { cn } from '@/lib/utils/cn';

/**
 * Post a brief.
 *
 * ── THE FLOW IS THE BRIEF'S SHAPE, NOT A WIZARD FOR ITS OWN SAKE ──────────
 *
 * What, where, when, how much. Four steps because those are the four things a
 * performer needs before they can put a number on it, and asking them one at a
 * time is what makes a form of nine fields feel like a conversation. Everything
 * else — guest count, notes — is optional and lives on the last step where it
 * cannot block anyone.
 *
 * ── IT IS ONE BRIEF, NOT A MESSAGE TO ONE ACT ─────────────────────────────
 *
 * That is the whole marketplace shape: the customer describes the job once and
 * every act that fits answers. Coming from a specific performer's page just
 * pre-fills the type and city, and the copy says so — a "message this band"
 * button that quietly broadcast to twelve would be a nasty surprise.
 *
 * ── SIGN-IN IS ASKED FOR AT THE END, NOT THE START ────────────────────────
 *
 * A brief needs an owner to send the quotes back to, so posting requires an
 * account. But asking for one before somebody has said what they want is how a
 * marketplace loses the people it is for — so the form is fully usable signed
 * out, and the last step carries the sign-in with a `?next=` back to here.
 *
 * ── THE PAGE HAD NO HEADING, AND NO PICTURE ───────────────────────────────
 *
 * The route rendered the stepper straight onto the canvas: an `h2` inside step
 * one was the first heading on the document, which is both a heading-order
 * problem and a page that opens with a form and no explanation of what it is
 * for. The header below is the `h1`, and it carries the illustration — so the
 * one screen somebody lands on from "Hire a band" looks like the thing they
 * pressed.
 *
 * ── EVERY CONTROL IS ON THE 44px FLOOR ────────────────────────────────────
 *
 * The type and occasion chips were 40px, which is under it, and there are
 * sixteen of them in a wrap on a phone. The step buttons are full width below
 * `sm` for the same reason — a "Continue" that shares a row with "Back" at
 * 44px each is two targets 8px apart at the bottom of a thumb's reach.
 */

const STEPS = ['What', 'Where', 'When', 'Budget'] as const;

/** Rupees. Converted to minor units at the boundary, once. */
const BUDGET_BANDS = [
  { min: 1_000_00, max: 2_500_00, label: '₹10,000 – ₹25,000' },
  { min: 2_500_00, max: 5_000_00, label: '₹25,000 – ₹50,000' },
  { min: 5_000_00, max: 10_000_00, label: '₹50,000 – ₹1,00,000' },
  { min: 10_000_00, max: 25_000_00, label: '₹1,00,000 – ₹2,50,000' },
  { min: 25_000_00, max: 100_000_00, label: '₹2,50,000+' },
];

export function BriefForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { status } = useAuth();

  const [step, setStep] = React.useState(0);
  const [type, setType] = React.useState<PerformerType | ''>(
    (params?.get('type') as PerformerType) ?? '',
  );
  const [occasion, setOccasion] = React.useState<Occasion | ''>('');
  const [city, setCity] = React.useState(params?.get('city') ?? '');
  const [eventDate, setEventDate] = React.useState('');
  const [band, setBand] = React.useState<number | null>(null);
  const [guests, setGuests] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const create = useMutation({
    mutationFn: createBookingRequest,
    onSuccess: (request) => router.push(`/hire/requests/${request.id}`),
    onError: (thrown) =>
      setError(
        thrown instanceof ApiError ? thrown.message : 'Could not post that brief. Try again.',
      ),
  });

  const chosen = band === null ? null : BUDGET_BANDS[band];
  const complete = [Boolean(type && occasion), Boolean(city), Boolean(eventDate), chosen !== null];
  const canAdvance = complete[step];
  const ready = complete.every(Boolean);

  const submit = () => {
    if (!ready || !chosen) return;
    setError(null);
    create.mutate({
      performer_type: type as PerformerType,
      occasion: occasion as Occasion,
      city: city.trim(),
      event_date: eventDate,
      budget_min_minor: chosen.min,
      budget_max_minor: chosen.max,
      guests: guests ? Number(guests) : null,
      notes: notes.trim(),
    });
  };

  // `datetime`'s own `min`, so the picker greys out the past rather than
  // letting somebody choose a date the API will reject.
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 sm:gap-8">
      <header className="flex items-center gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h1 className="text-h3 sm:text-h2">Tell us about your event</h1>
          <p className="text-body-sm text-muted-foreground">
            One brief, four short steps. Every act that fits it can answer with a real quote.
          </p>
        </div>
        <SpotHireABand className="h-16 w-auto shrink-0 sm:h-24" />
      </header>

      <nav aria-label="Progress">
        <ol className="flex gap-2">
          {STEPS.map((label, index) => (
            <li key={label} className="flex flex-1 flex-col gap-1.5">
              <span
                className={cn(
                  'h-1 rounded-full transition-colors duration-base motion-reduce:transition-none',
                  index <= step ? 'bg-primary' : 'bg-muted',
                )}
                aria-hidden
              />
              <span
                className={cn(
                  'text-caption',
                  index === step ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
            </li>
          ))}
        </ol>
      </nav>

      <div className="min-h-64">
        {step === 0 ? (
          <Fieldset
            title="What are you looking for?"
            blurb="Pick the kind of act. Every performer of that kind in your city will see the brief."
          >
            <ActPicker value={type} onChange={setType} />
            <Chips
              label="Occasion"
              options={(Object.keys(OCCASION_LABELS) as Occasion[]).map((value) => ({
                value,
                label: OCCASION_LABELS[value],
              }))}
              value={occasion}
              onChange={(value) => setOccasion(value as Occasion)}
            />
          </Fieldset>
        ) : step === 1 ? (
          <Fieldset
            title="Where is it?"
            blurb="Acts based in this city see your brief. Many travel further — their profiles say how far."
          >
            <div className="flex flex-col gap-2">
              <label htmlFor="brief-city" className="text-body-sm font-medium">
                City
              </label>
              <input
                id="brief-city"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                placeholder="Mumbai"
                className="h-12 rounded-xl border border-border bg-background px-4 text-body-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <ul className="flex flex-wrap gap-1.5 pt-1">
                {POPULAR_CITIES.slice(0, 8).map((entry) => (
                  <li key={entry.name}>
                    <button
                      type="button"
                      onClick={() => setCity(entry.name)}
                      aria-pressed={city === entry.name}
                      className={cn(
                        // 44px on a phone, 32px from `sm` — the same treatment
                        // every chip row in this slice got.
                        'inline-flex min-h-control items-center rounded-full border px-3 text-caption transition-colors sm:h-8 sm:min-h-0',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        city === entry.name
                          ? 'border-primary bg-secondary text-secondary-foreground'
                          : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {entry.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </Fieldset>
        ) : step === 2 ? (
          <Fieldset
            title="When is it?"
            blurb="A performer needs the date before they can say whether they are free, or what it costs."
          >
            <div className="flex flex-col gap-2">
              <label htmlFor="brief-date" className="text-body-sm font-medium">
                Event date
              </label>
              <input
                id="brief-date"
                type="date"
                value={eventDate}
                min={today}
                onChange={(event) => setEventDate(event.target.value)}
                className="h-12 w-full rounded-xl border border-border bg-background px-4 text-body-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-64"
              />
            </div>
          </Fieldset>
        ) : (
          <Fieldset
            title="What is the budget?"
            blurb="A range, not a number — it is how performers decide whether to answer at all, and a brief with no budget gets far fewer replies."
          >
            <ul className="flex flex-col gap-2">
              {BUDGET_BANDS.map((option, index) => (
                <li key={option.label}>
                  <button
                    type="button"
                    onClick={() => setBand(index)}
                    aria-pressed={band === index}
                    className={cn(
                      'flex min-h-control w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      band === index
                        ? 'border-primary bg-secondary text-secondary-foreground'
                        : 'border-border hover:bg-muted',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-flex size-5 shrink-0 items-center justify-center rounded-full border',
                        band === index ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                      )}
                      aria-hidden
                    >
                      {band === index ? <Check className="size-3" /> : null}
                    </span>
                    <span className="text-body-sm">{option.label}</span>
                  </button>
                </li>
              ))}
            </ul>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label htmlFor="brief-guests" className="text-body-sm font-medium">
                  Guests <span className="font-normal text-muted-foreground">— optional</span>
                </label>
                <input
                  id="brief-guests"
                  inputMode="numeric"
                  value={guests}
                  onChange={(event) => setGuests(event.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="200"
                  className="h-12 rounded-xl border border-border bg-background px-4 text-body-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="brief-notes" className="text-body-sm font-medium">
                Anything else <span className="font-normal text-muted-foreground">— optional</span>
              </label>
              <textarea
                id="brief-notes"
                rows={4}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Evening reception, outdoors, we would like a mix of Hindi and English sets. PA system is provided."
                className="rounded-xl border border-border bg-background px-4 py-3 text-body-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </Fieldset>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-body-sm text-destructive">
          {error}
        </p>
      ) : null}

      {/* Stacked and full width below `sm`, with the forward action at the
          BOTTOM — the end of the thumb's arc — and "Back" above it. Side by
          side they were two 44px targets 12px apart at the bottom of the
          screen, which is where a mis-tap costs somebody their answers. */}
      <div className="flex flex-col gap-2 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:pt-6">
        {step > 0 ? (
          <button
            type="button"
            onClick={() => setStep((value) => value - 1)}
            className="inline-flex h-control items-center justify-center gap-1.5 rounded-xl border border-border px-4 text-label transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back
          </button>
        ) : (
          <span className="hidden sm:block" />
        )}

        {step < STEPS.length - 1 ? (
          <button
            type="button"
            disabled={!canAdvance}
            onClick={() => setStep((value) => value + 1)}
            className="inline-flex h-control items-center justify-center gap-1.5 rounded-xl bg-cta px-5 text-label text-cta-foreground transition-colors hover:bg-cta-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Continue
            <ArrowRight className="size-4" aria-hidden />
          </button>
        ) : status === 'anonymous' ? (
          // Asked for at the END. A brief needs an owner to send quotes back
          // to, but asking before somebody has said what they want is how a
          // marketplace loses the people it is for.
          <Link
            href="/sign-in?next=%2Fhire%2Fnew"
            className="inline-flex h-control items-center justify-center gap-1.5 rounded-xl bg-cta px-5 text-label text-cta-foreground transition-colors hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Sign in to post this brief
          </Link>
        ) : (
          <button
            type="button"
            disabled={!ready || create.isPending}
            onClick={submit}
            className="inline-flex h-control items-center justify-center gap-2 rounded-xl bg-cta px-5 text-label text-cta-foreground transition-colors hover:bg-cta-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {create.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Request quotes
          </button>
        )}
      </div>
    </div>
  );
}

function Fieldset({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 animate-in fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none">
      <header className="flex flex-col gap-1.5">
        <h2 className="text-h3">{title}</h2>
        <p className="max-w-prose text-body-sm text-muted-foreground">{blurb}</p>
      </header>
      {children}
    </div>
  );
}

/**
 * The kind of act, as illustrated tiles rather than a wrap of nine pills.
 *
 * This is the first question in the funnel and the one that decides who ever
 * sees the brief, so it gets the artwork and the room. Nine 40px pills wrapped
 * across four lines was the smallest, least distinguishable control on the
 * most consequential step. The tile is the same object the marketplace card
 * and the landing section use for that type, so "DJ" looks like the same thing
 * everywhere in the product.
 */
function ActPicker({
  value,
  onChange,
}: {
  value: PerformerType | '';
  onChange: (value: PerformerType) => void;
}) {
  const types = Object.keys(PERFORMER_TYPE_LABELS) as PerformerType[];

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-body-sm font-medium">Act</legend>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {types.map((option) => (
          <li key={option}>
            <button
              type="button"
              onClick={() => onChange(option)}
              aria-pressed={value === option}
              className={cn(
                'flex min-h-control w-full items-center gap-2 rounded-xl border p-2 text-left transition-colors duration-fast',
                'motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                value === option
                  ? 'border-primary bg-secondary text-secondary-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <PerformerArt type={option} className="size-9 shrink-0 sm:size-10" />
              <span className="min-w-0 text-caption font-medium leading-tight sm:text-body-sm">
                {PERFORMER_TYPE_LABELS[option]}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function Chips({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-body-sm font-medium">{label}</legend>
      <ul className="flex flex-wrap gap-2">
        {options.map((option) => (
          <li key={option.value}>
            <button
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={value === option.value}
              className={cn(
                // `h-control` (44px), not 40 — sixteen of these wrap across a
                // phone and every one of them is a thumb target.
                'inline-flex h-control items-center rounded-full border px-4 text-body-sm transition-colors duration-fast',
                'motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                value === option.value
                  ? 'border-primary bg-secondary text-secondary-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
