'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import {
  OCCASION_LABELS,
  PERFORMER_TYPE_LABELS,
  createEnquiry,
  type Occasion,
  type PerformerType,
} from '@/lib/api/enquiries';
import { ApiError } from '@/lib/api/errors';
import { SpotHireABand } from '@/components/illustrations/spots';
import { SceneOnboardingDone } from '@/components/illustrations/onboarding-scenes';
import { useAuth } from '@/lib/auth/auth-provider';
import { POPULAR_CITIES } from '@/lib/discovery/cities';
import { PerformerScene } from '@/components/illustrations/performer-scenes';
import { DayPicker } from '@/components/ui/day-picker';
import { CityCombobox } from '@/components/ui/city-combobox';
import { cn } from '@/lib/utils/cn';

/**
 * Send an enquiry.
 *
 * ── WHAT THIS USED TO BE ──────────────────────────────────────────────────
 *
 * A marketplace brief: the customer described the job once and every listed
 * act that fitted answered with a quote. There is no supply side any more —
 * this goes to a person on our team, who reads it and gets back in touch.
 *
 * That is not a smaller version of the same thing, and the copy on every step
 * had to change with it. "Every act in your city will see this" was true and
 * is now a lie; "our team will read this" is what happens.
 *
 * ── THE FLOW IS THE ENQUIRY'S SHAPE, NOT A WIZARD FOR ITS OWN SAKE ────────
 *
 * What, where, when, how much, and how to reach you. Five steps because those
 * are the five things somebody has to know before they can pick up the phone,
 * and asking them one at a time is what makes a form of ten fields feel like a
 * conversation. Everything optional — guest count, notes — sits with the
 * budget where it cannot block anyone.
 *
 * ── THE CONTACT STEP IS THE ONE THAT MATTERS ──────────────────────────────
 *
 * Nothing is matched automatically. If the details are wrong or missing,
 * nobody can answer — so this step is last (it is the least interesting
 * question, and asking it first is how a form gets abandoned), it is
 * PRE-FILLED from the account, and everything on it is optional precisely
 * because the account already has an email address to fall back to.
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

const STEPS = ['What', 'Where', 'When', 'Budget', 'You'] as const;

/** Rupees. Converted to minor units at the boundary, once. */
/**
 * The bands are SHORTCUTS now, not the only way to answer.
 *
 * Five fixed brackets ending at "₹2,50,000+" cannot express a real budget —
 * a wedding with ₹4,00,000 to spend picked the top band and was quoted as if
 * it had ₹2,50,000. The form takes a min and a max; pressing a band fills
 * them, and either can then be typed over.
 */
const BUDGET_BANDS = [
  { min: 1_000_00, max: 2_500_00, label: '₹10,000 – ₹25,000' },
  { min: 2_500_00, max: 5_000_00, label: '₹25,000 – ₹50,000' },
  { min: 5_000_00, max: 10_000_00, label: '₹50,000 – ₹1,00,000' },
  { min: 10_000_00, max: 25_000_00, label: '₹1,00,000 – ₹2,50,000' },
  { min: 25_000_00, max: 100_000_00, label: '₹2,50,000+' },
];

export function BriefForm() {
  const params = useSearchParams();
  const { status, user } = useAuth();

  const [step, setStep] = React.useState(0);
  const [type, setType] = React.useState<PerformerType | ''>(
    (params?.get('type') as PerformerType) ?? '',
  );
  const [occasion, setOccasion] = React.useState<Occasion | ''>('');
  /**
   * What "Something else" actually was.
   *
   * The chip alone told the person reading the brief nothing — "other" is the
   * one answer that carries no information, and it is chosen precisely when
   * the list did not fit. Asking straight away is cheaper than a reply that
   * only asks what they meant.
   *
   * Appended to the notes on submit rather than stored in a column: the
   * backend's `type` and `occasion` are enums, and inventing a free-text
   * column for them would mean a value nothing else can read.
   */
  const [typeOther, setTypeOther] = React.useState('');
  const [occasionOther, setOccasionOther] = React.useState('');
  const [city, setCity] = React.useState(params?.get('city') ?? '');
  const [eventDate, setEventDate] = React.useState('');
  const [band, setBand] = React.useState<number | null>(null);
  /**
   * The actual numbers, in RUPEES (the API takes paise; converted on submit).
   *
   * Five fixed brackets ending at "₹2,50,000+" could not express a real
   * budget: a wedding with ₹4,00,000 had to pick the top band and was read as
   * having ₹2,50,000. Pressing a band fills these; either can then be typed
   * over, which is what makes the bands a shortcut rather than the only
   * vocabulary.
   */
  const [budgetMin, setBudgetMin] = React.useState('');
  const [budgetMax, setBudgetMax] = React.useState('');
  const [guests, setGuests] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [contactName, setContactName] = React.useState('');
  const [contactPhone, setContactPhone] = React.useState('');
  const [contactEmail, setContactEmail] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);

  // Pre-filled from the account, once it has loaded. `??=` semantics by way of
  // the empty check: a value somebody has already typed is never overwritten
  // by a profile arriving a moment later.
  React.useEffect(() => {
    if (!user) return;
    setContactName((current) => current || user.full_name || '');
    setContactPhone((current) => current || user.phone || '');
    setContactEmail((current) => current || user.email || '');
  }, [user]);

  const create = useMutation({
    mutationFn: createEnquiry,
    // No detail page to land on — there is nothing to watch. The confirmation
    // is inline and says what happens next, which is the only thing anybody
    // wants at that moment.
    onSuccess: () => setSent(true),
    onError: (thrown) =>
      setError(
        thrown instanceof ApiError ? thrown.message : 'Could not send that enquiry. Try again.',
      ),
  });

  /**
   * The budget step is complete when there are two usable numbers, whether
   * they came from a band or were typed. Reading the BAND here would have made
   * a hand-typed range look unanswered — the exact thing the range was added
   * to allow.
   */
  const budgetReady =
    budgetMin !== '' && budgetMax !== '' && Number(budgetMax) >= Number(budgetMin);

  const complete = [
    Boolean(type && occasion),
    Boolean(city),
    Boolean(eventDate),
    budgetReady,
    // Nothing on the contact step is required: the account has an email, and
    // the server falls back to it. Blocking here would be the form insisting
    // on a value it can already answer for itself.
    true,
  ];
  const canAdvance = complete[step];
  const ready = complete.every(Boolean);

  /**
   * The notes, with whatever "Something else" turned out to mean.
   *
   * Prepended rather than appended: it is the answer to the FIRST question on
   * the form, and somebody reading the brief needs to know what kind of act is
   * being asked for before they read the description of the evening.
   *
   * Collected and then dropped would be worse than never asking — the person
   * typed it, so it has to arrive.
   */
  const composedNotes = () => {
    const lines: string[] = [];
    if (type === 'other' && typeOther.trim()) lines.push(`Act: ${typeOther.trim()}`);
    if (occasion === 'other' && occasionOther.trim()) {
      lines.push(`Occasion: ${occasionOther.trim()}`);
    }
    const rest = notes.trim();
    if (rest) lines.push(rest);
    return lines.join('\n');
  };

  const submit = () => {
    if (!ready) return;
    setError(null);
    create.mutate({
      performer_type: type as PerformerType,
      occasion: occasion as Occasion,
      city: city.trim(),
      event_date: eventDate,
      budget_min_minor: rupeesToMinor(budgetMin),
      budget_max_minor: rupeesToMinor(budgetMax),
      guests: guests ? Number(guests) : null,
      notes: composedNotes(),
      contact_name: contactName.trim(),
      contact_phone: contactPhone.trim(),
      contact_email: contactEmail.trim(),
    });
  };

  // `datetime`'s own `min`, so the picker greys out the past rather than
  // letting somebody choose a date the API will reject.
  const today = new Date().toISOString().slice(0, 10);

  if (sent) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 py-6 text-center">
        <SceneOnboardingDone className="h-40 w-52" />
        <div className="flex flex-col gap-2">
          <h1 className="text-h3 sm:text-h2">We have your enquiry</h1>
          {/* NO TIMEFRAME. Nothing here measures or enforces one, so "within
              24 hours" would be a number with nothing behind it — and the
              first person it disappoints is somebody already waiting. What it
              promises instead is checkable: a person reads it, and replies to
              the details given. */}
          <p className="max-w-prose text-body-sm text-muted-foreground">
            It is with our team now. Somebody will read it and get back to you on the details
            you gave us — we have emailed you a copy.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/events"
            className="inline-flex h-control items-center justify-center rounded-xl bg-cta px-5 text-label text-cta-foreground transition-colors hover:bg-cta-hover"
          >
            Browse events
          </Link>
          <button
            type="button"
            onClick={() => {
              setSent(false);
              setStep(0);
              setType('');
              setOccasion('');
              setCity('');
              setEventDate('');
              setBand(null);
              setGuests('');
              setNotes('');
            }}
            className="inline-flex h-control items-center justify-center rounded-xl border border-border px-5 text-label transition-colors hover:bg-muted"
          >
            Send another
          </button>
        </div>
      </div>
    );
  }

  return (
    // ── A RAIL AND A CARD, NOT ONE CENTRED COLUMN ──────────────────────
    //
    // This was a 2xl column with a header, a progress bar and the step
    // floating on the page background. It read as a document rather than a
    // form: nothing bounded the fields, the artwork sat beside a heading with
    // no relationship to the work, and on a wide screen the whole thing was a
    // narrow strip in a lot of empty page.
    //
    // The shape now is the one every good multi-step form has. A sticky rail
    // carries the steps VERTICALLY — five labels down a column are readable
    // where five under a bar are five truncated words — plus the two things
    // somebody hesitating actually wants to know: that it is free, and that a
    // person reads it. The form sits in a bordered surface, so the fields have
    // an edge and the page has a subject.
    <div className="mx-auto grid w-full max-w-5xl gap-block lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-block-lg">
      <aside className="flex flex-col gap-block lg:sticky lg:top-sticky-top-lg lg:self-start">
        <header className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <h1 className="text-h4 sm:text-h3">Tell us about your event</h1>          </div>
          <SpotHireABand className="h-14 w-auto shrink-0 lg:hidden" />
        </header>

        <SpotHireABand className="hidden h-32 w-auto self-start lg:block" />

        {/* Vertical on desktop, and a horizontal bar under `lg` — five labels
            in a row on a phone is five truncated words, which is a progress
            indicator that has stopped indicating anything. */}
        <nav aria-label="Progress" className="hidden lg:block">
          <ol className="flex flex-col gap-1">
            {STEPS.map((label, index) => (
              <li key={label}>
                <span
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-body-sm transition-colors duration-base motion-reduce:transition-none',
                    index === step
                      ? 'bg-nav-active font-medium text-nav-active-foreground'
                      : index < step
                        ? 'text-foreground'
                        : 'text-muted-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-caption tabular-nums',
                      index < step
                        ? 'bg-primary text-primary-foreground'
                        : index === step
                          ? 'bg-nav-active-foreground/15'
                          : 'bg-muted',
                    )}
                    aria-hidden
                  >
                    {index < step ? <Check className="size-3" /> : index + 1}
                  </span>
                  {label}
                </span>
              </li>
            ))}
          </ol>
        </nav>

      </aside>

      <div className="flex min-w-0 flex-col gap-block">
        <nav aria-label="Progress" className="lg:hidden">
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
                    'truncate text-caption',
                    index === step ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {label}
                </span>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-h-64 rounded-xl border border-border bg-surface p-card shadow-sm lg:p-card-lg">
        {step === 0 ? (
          <Fieldset
            title="What are you looking for?"
            blurb="Pick the kind of act. If it is not here, choose something else and describe it in the notes."
          >
            <ActPicker value={type} onChange={setType} />
            {/* "Something else" is the one answer that carries no information,
                and it is chosen exactly when the list did not fit. Asking here
                is cheaper than a reply whose only content is "what did you
                mean?". Both answers ride along in the notes on submit — the
                backend's `type` and `occasion` are enums, and a free-text
                column beside them would hold a value nothing else can read. */}
            {type === 'other' ? (
              <OtherField
                id="brief-type-other"
                label="What kind of act?"
                placeholder="A qawwali group"
                value={typeOther}
                onChange={setTypeOther}
              />
            ) : null}
            <Chips
              label="Occasion"
              options={(Object.keys(OCCASION_LABELS) as Occasion[]).map((value) => ({
                value,
                label: OCCASION_LABELS[value],
              }))}
              value={occasion}
              onChange={(value) => setOccasion(value as Occasion)}
            />
            {occasion === 'other' ? (
              <OtherField
                id="brief-occasion-other"
                label="What is the occasion?"
                placeholder="A retirement party"
                value={occasionOther}
                onChange={setOccasionOther}
              />
            ) : null}
          </Fieldset>
        ) : step === 1 ? (
          <Fieldset
            title="Where is it?"
            blurb="The city the event is in. We will tell you what is available there, and what it costs to bring somebody in."
          >
            <div className="flex flex-col gap-2">
              <label htmlFor="brief-city" className="text-body-sm font-medium">
                City
              </label>
              {/* A real combobox, not the `datalist` this was. That element
                  renders NOTHING until somebody types, so a step showing nine
                  chips and a box looked like it offered nine cities — which is
                  exactly how it was reported. The list opens on focus now and
                  filters as you type, which is what the WAI-ARIA combobox
                  pattern prescribes and what the header's city switcher
                  already does over the same 186 rows.

                  Still free text: somebody in a town we do not list can type
                  it and be heard. The list is a shortcut, never a gate. */}
              <CityCombobox id="brief-city" value={city} onChange={setCity} />
              <ul className="flex flex-wrap gap-1.5 pt-1">
                {/* The chips stay the popular few — a hundred of them is a
                    wall, not a shortcut. Every other city is one press of the
                    field away, in a list that is visible rather than implied. */}
                {POPULAR_CITIES.map((entry) => (
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
              {/* The same calendar the profile uses. `yearRange` is this
                  year and the next two — a booking further out than that is
                  not a date somebody is picking from a grid, and offering a
                  hundred years here would be as unhelpful as offering ten on a
                  birthday. */}
              <DayPicker
                id="brief-date"
                value={eventDate || null}
                onChange={setEventDate}
                min={today}
                yearRange={{ from: new Date().getFullYear(), to: new Date().getFullYear() + 2 }}
                placeholder="Pick the date"
                className="sm:w-64"
              />
            </div>
          </Fieldset>
        ) : step === 3 ? (
          <Fieldset
            title="What is the budget?"
            blurb="A range, not a number. This is not a commitment."
          >
            <BudgetRange
              min={budgetMin}
              max={budgetMax}
              onMin={(value) => {
                setBudgetMin(value);
                // Typing over a band means the band no longer describes the
                // answer, so it stops being shown as chosen.
                setBand(null);
              }}
              onMax={(value) => {
                setBudgetMax(value);
                setBand(null);
              }}
            />

            <p className="pt-1 text-caption text-muted-foreground">Or pick a range</p>
            <ul className="flex flex-col gap-2">
              {BUDGET_BANDS.map((option, index) => (
                <li key={option.label}>
                  <button
                    type="button"
                    onClick={() => {
                      setBand(index);
                      setBudgetMin(String(option.min / 100));
                      setBudgetMax(String(option.max / 100));
                    }}
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
        ) : (
          <Fieldset
            title="How should we reach you?"
            blurb="Pre-filled from your account. Change it if somebody else is organising."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label htmlFor="brief-contact-name" className="text-body-sm font-medium">
                  Name
                </label>
                <input
                  id="brief-contact-name"
                  value={contactName}
                  maxLength={150}
                  onChange={(event) => setContactName(event.target.value)}
                  placeholder="Asha Rao"
                  className="h-12 rounded-xl border border-border bg-background px-4 text-body-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="brief-contact-phone" className="text-body-sm font-medium">
                  Phone
                </label>
                <input
                  id="brief-contact-phone"
                  type="tel"
                  value={contactPhone}
                  maxLength={20}
                  onChange={(event) => setContactPhone(event.target.value)}
                  placeholder="+91 98765 43210"
                  className="h-12 rounded-xl border border-border bg-background px-4 text-body-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="brief-contact-email" className="text-body-sm font-medium">
                Email
              </label>
              <input
                id="brief-contact-email"
                type="email"
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
                placeholder="asha@example.com"
                className="h-12 rounded-xl border border-border bg-background px-4 text-body-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {/* Nothing here is required, and saying so is the point: the
                  account already has an address the server falls back to, so a
                  required field would be the form insisting on a value it can
                  answer for itself. */}
              <p className="text-caption text-muted-foreground">
                Leave any of these blank and we will use your account details.
              </p>
            </div>
          </Fieldset>
        )}

        {error ? (
          <p role="alert" className="pt-4 text-body-sm text-destructive">
            {error}
          </p>
        ) : null}

        {/* INSIDE the card, so the rule above it reads as the card's own
            footer rather than a line drawn across the page.

            Stacked and full width below `sm`, with the forward action at the
            BOTTOM — the end of the thumb's arc — and "Back" above it. Side by
            side they were two 44px targets 12px apart at the bottom of the
            screen, which is where a mis-tap costs somebody their answers. */}
        <div className="mt-block flex flex-col gap-2 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:pt-6">
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
            href="/sign-in?next=%2Fhire"
            className="inline-flex h-control items-center justify-center gap-1.5 rounded-xl bg-cta px-5 text-label text-cta-foreground transition-colors hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Sign in to send this
          </Link>
        ) : (
          <button
            type="button"
            disabled={!ready || create.isPending}
            onClick={submit}
            className="inline-flex h-control items-center justify-center gap-2 rounded-xl bg-cta px-5 text-label text-cta-foreground transition-colors hover:bg-cta-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {create.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Send enquiry
          </button>
        )}
        </div>
      </div>
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

  // ── THE GAP HAS TO BE A MARGIN ON THE LEGEND ────────────────────────────
  // A `<legend>` is the fieldset's CAPTION, not one of its flex items, so a
  // `gap-*` on the fieldset never applies to it. This was first "fixed" by
  // raising the gap from 8px to 12px, which changed the computed `row-gap`
  // and moved nothing: measured in the browser afterwards, the legend's
  // bottom and the grid's top were the same pixel, both before and after.
  // `mb-3` is on the legend itself, which does apply.
  return (
    <fieldset className="flex flex-col">
      <legend className="mb-3 text-body-sm font-medium">Act</legend>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {types.map((option) => (
          <li key={option} className={option === 'other' ? 'col-span-2 sm:col-span-1' : undefined}>
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
              {/* The same scene the homepage tile shows, so somebody who
                  pressed "Band" there recognises what they picked here. It
                  keeps its 4:3 box: cropping a scene to a square cuts the
                  ground out from under the figures. */}
              <PerformerScene type={option} className="h-10 w-[3.3rem] shrink-0 sm:h-11 sm:w-14" />
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
    <fieldset className="flex flex-col">
      {/* `mb-3` on the legend, not `gap` on the fieldset — see ActPicker. */}
      <legend className="mb-3 text-body-sm font-medium">{label}</legend>
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

/**
 * The one extra question a "Something else" answer earns.
 *
 * Deliberately not required: somebody who cannot name it in the chip list may
 * not be able to name it in a box either, and blocking the form on a label is
 * worse than reading it in the notes. It is a prompt, not a gate.
 */
function OtherField({
  id,
  label,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-body-sm font-medium">
        {label} <span className="text-muted-foreground">— optional</span>
      </label>
      <input
        id={id}
        value={value}
        maxLength={80}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-12 rounded-xl border border-border bg-background px-4 text-body-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}

/** Rupees as typed -> paise, which is what the API stores. */
function rupeesToMinor(value: string): number {
  const parsed = Number(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

/**
 * Two numbers rather than one, and it is worth saying why.
 *
 * A single figure invites every reply to be exactly it. A range says what is
 * comfortable and what is the ceiling, which is the conversation somebody is
 * actually trying to have — and it is what the API has always stored
 * (`budget_min_minor` / `budget_max_minor`); the form was the part that could
 * only offer five brackets.
 */
function BudgetRange({
  min,
  max,
  onMin,
  onMax,
}: {
  min: string;
  max: string;
  onMin: (value: string) => void;
  onMax: (value: string) => void;
}) {
  const invalid = min !== '' && max !== '' && Number(max) < Number(min);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { id: 'brief-budget-min', label: 'Minimum', value: min, onChange: onMin, hint: '10,000' },
          { id: 'brief-budget-max', label: 'Maximum', value: max, onChange: onMax, hint: '50,000' },
        ].map((field) => (
          <div key={field.id} className="flex flex-col gap-1.5">
            <label htmlFor={field.id} className="text-body-sm font-medium">
              {field.label}
            </label>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-4 focus-within:ring-2 focus-within:ring-ring">
              <span className="text-body-sm text-muted-foreground" aria-hidden>
                ₹
              </span>
              <input
                id={field.id}
                // `inputMode` rather than `type="number"`: a number input on a
                // phone still shows a spinner and rejects a pasted "50,000".
                inputMode="numeric"
                value={field.value}
                onChange={(event) => field.onChange(event.target.value.replace(/[^0-9]/g, ''))}
                placeholder={field.hint}
                className="h-12 w-full bg-transparent text-body-sm outline-none"
              />
            </div>
          </div>
        ))}
      </div>
      {invalid ? (
        <p role="alert" className="text-caption text-destructive-subtle-foreground">
          The maximum is below the minimum.
        </p>
      ) : null}
    </div>
  );
}
