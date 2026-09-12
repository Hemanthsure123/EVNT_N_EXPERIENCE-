'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import {
  Briefcase,
  Cake,
  Check,
  GraduationCap,
  Heart,
  Loader2,
  PartyPopper,
  Sparkles,
  Tent,
} from 'lucide-react';
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
 * That is not a smaller version of the same thing, and the copy on every
 * section had to change with it. "Every act in your city will see this" was
 * true and is now a lie; "our team will read this" is what happens.
 *
 * ── IT WAS A FIVE-STEP WIZARD, AND IT IS ONE PAGE NOW ─────────────────────
 *
 * The decision has gone both ways and the history is the point. The wizard's
 * own argument, kept here because it was a real one: asking one thing at a
 * time is what makes a form of ten fields feel like a conversation.
 *
 * What that argument misses is the SIZE of this particular form. Ten fields
 * across five steps is two fields a screen — four "Continue" presses and four
 * navigations to answer what fits on one phone screen and a half. And the
 * step rail made each one a TAB: a hard boundary with its own bordered card,
 * so the only way to check what you had already said was to walk backwards
 * through it and then walk forwards again. A person filling in a brief
 * revises: the budget they type depends on the date they picked, which
 * depends on the act. A wizard is right when each answer CHANGES what is
 * asked next (the event studio, which genuinely branches) and wrong when the
 * questions are simply a list, which these are.
 *
 * So: one scrolling column, five titled sections, no card boundaries between
 * them, and every answer visible at once. The gate moved with it — there is
 * no per-step "Continue" to disable, so Send names what is still missing and
 * each name is a link to the section that fixes it.
 *
 * ── THE RAIL IS A MAP NOW, NOT A STEPPER ──────────────────────────────────
 *
 * It marks which sections are answered and jumps to any of them, in either
 * direction, at any time — an in-page table of contents rather than a
 * progress bar. It follows the scroll through an IntersectionObserver (see
 * `useActiveSection`); a stepper's index is state the form owns, and a map's
 * is a fact about where the reader is.
 *
 * ── SIGN-IN IS ASKED FOR AT THE END, NOT THE START ────────────────────────
 *
 * A brief needs an owner to send the reply back to, so posting requires an
 * account. But asking for one before somebody has said what they want is how
 * a marketplace loses the people it is for — so the form is fully usable
 * signed out, and the send row carries the sign-in with a `?next=` back here.
 *
 * ── EVERY CONTROL IS ON THE 44px FLOOR ────────────────────────────────────
 *
 * The selectable cards, the chips, the inputs and the send button. The cards
 * are a CSS grid rather than a wrap of pills for the same reason: nine 40px
 * pills across four lines was the smallest, least distinguishable control on
 * the most consequential question.
 */

/** The sections, in order. `id` is the anchor the rail jumps to. */
const SECTIONS = [
  { id: 'brief-act', label: 'The act' },
  { id: 'brief-place', label: 'Place & date' },
  { id: 'brief-budget', label: 'Budget' },
  { id: 'brief-details', label: 'Details' },
  { id: 'brief-contact', label: 'Contact' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

/**
 * A vector icon per occasion.
 *
 * The act picker has real artwork (`PerformerScene`) because an act is a
 * thing you can draw. An occasion is not — "Corporate event" has no picture
 * that is not a stock photograph — so it gets a line icon, which is honest
 * about being a label rather than an illustration.
 */
const OCCASION_ICONS: Record<Occasion, React.ComponentType<{ className?: string }>> = {
  wedding: Heart,
  corporate: Briefcase,
  birthday: Cake,
  festival: Tent,
  college: GraduationCap,
  private: PartyPopper,
  other: Sparkles,
};

/**
 * The slider's range, in RUPEES, and why it stops where it does.
 *
 * A slider needs bounds and a brief does not, so the ceiling is a slider
 * ceiling rather than a budget ceiling: dragging to the top sets ₹10,00,000
 * and the number field beside it still takes anything typed. That asymmetry
 * is deliberate — the control that cannot express every answer must never be
 * the only way to give one, which is the same mistake the five fixed bands
 * made.
 */
const SLIDER_MIN = 5_000;
const SLIDER_MAX = 1_000_000;
const SLIDER_STEP = 5_000;

export function BriefForm() {
  const params = useSearchParams();
  const { status, user } = useAuth();

  const [type, setType] = React.useState<PerformerType | ''>(
    (params?.get('type') as PerformerType) ?? '',
  );
  const [occasion, setOccasion] = React.useState<Occasion | ''>('');
  /**
   * What "Something else" actually was.
   *
   * The card alone told the person reading the brief nothing — "other" is the
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
  /**
   * The actual numbers, in RUPEES (the API takes paise; converted on submit).
   *
   * Five fixed brackets ending at "₹2,50,000+" could not express a real
   * budget: a wedding with ₹4,00,000 had to pick the top band and was read as
   * having ₹2,50,000. The brackets are gone entirely now — the slider and
   * these two fields are the whole control, and neither has a ceiling the
   * other cannot pass.
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
   * The budget is answered when there are two usable numbers, whether they
   * came from a band, a drag or a keyboard. Reading the BAND here would have
   * made a hand-typed range look unanswered — the exact thing the range was
   * added to allow.
   */
  const budgetReady =
    budgetMin !== '' && budgetMax !== '' && Number(budgetMax) >= Number(budgetMin);

  /**
   * WHAT IS STILL MISSING, NAMED — not a count and not a disabled button on
   * its own.
   *
   * The wizard could gate per step because it only ever showed one. On a page
   * that shows everything, a Send that is simply dim is a control with no
   * explanation anywhere on screen; each entry here is a link to the section
   * that fixes it, which is the same move the publish Review screen makes.
   *
   * The contact section is absent on purpose: nothing on it is required. The
   * account already carries an email and the server falls back to it, so
   * demanding one would be the form insisting on a value it can answer for
   * itself.
   */
  const missing: { label: string; section: SectionId }[] = [
    ...(type ? [] : [{ label: 'the kind of act', section: 'brief-act' as const }]),
    ...(occasion ? [] : [{ label: 'the occasion', section: 'brief-act' as const }]),
    ...(city.trim() ? [] : [{ label: 'the city', section: 'brief-place' as const }]),
    ...(eventDate ? [] : [{ label: 'the date', section: 'brief-place' as const }]),
    ...(budgetReady ? [] : [{ label: 'a budget range', section: 'brief-budget' as const }]),
  ];
  const ready = missing.length === 0;

  /** Which rail entries draw a tick. Details and Contact are never required,
   *  so they tick when TOUCHED — a tick that can never appear is decoration. */
  const answered: Record<SectionId, boolean> = {
    'brief-act': Boolean(type && occasion),
    'brief-place': Boolean(city.trim() && eventDate),
    'brief-budget': budgetReady,
    'brief-details': Boolean(guests.trim() || notes.trim()),
    'brief-contact': Boolean(contactName.trim() || contactPhone.trim() || contactEmail.trim()),
  };

  const active = useActiveSection();

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
            It is with our team now. Somebody will read it and get back to you on the details you
            gave us — we have emailed you a copy.
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
              setType('');
              setOccasion('');
              setCity('');
              setEventDate('');
              setBudgetMin('');
              setBudgetMax('');
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
    <div className="mx-auto grid w-full max-w-5xl gap-block lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-block-lg">
      <aside className="flex flex-col gap-block lg:sticky lg:top-sticky-top-lg lg:self-start">
        <header className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <h1 className="text-h4 sm:text-h3">Tell us about your event</h1>
            <p className="text-body-sm text-muted-foreground">
              Five short questions. A person on our team reads every one.
            </p>
          </div>
          <SpotHireABand className="h-14 w-auto shrink-0 lg:hidden" />
        </header>

        <SpotHireABand className="hidden h-28 w-auto self-start lg:block" />

        {/* An in-page map, desktop only. Below `lg` the sections are simply
            one after another and a duplicate list of links to things a thumb
            reaches by scrolling is a second thing to scroll past. */}
        <nav aria-label="Sections" className="hidden lg:block">
          <ol className="flex flex-col gap-0.5">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  aria-current={active === section.id ? 'true' : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-body-sm transition-colors duration-base motion-reduce:transition-none',
                    active === section.id
                      ? 'bg-nav-active font-medium text-nav-active-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-caption tabular-nums transition-colors duration-base motion-reduce:transition-none',
                      answered[section.id]
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground',
                    )}
                    aria-hidden
                  >
                    {answered[section.id] ? (
                      <Check className="size-3" />
                    ) : (
                      SECTIONS.indexOf(section) + 1
                    )}
                  </span>
                  {section.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </aside>

      {/* ── ONE COLUMN, NO CARDS BETWEEN SECTIONS ──────────────────────────
          The sections are separated by space and a hairline rule rather than
          by five bordered surfaces. A boundary per question is what made the
          old steps read as tabs, and it is the thing this redesign removes;
          the rule is there so a long scroll still has a rhythm. */}
      <form
        className="flex min-w-0 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Section
          id="brief-act"
          index={1}
          title="What are you looking for?"
        >
          <CardGrid label="Act">
            {(Object.keys(PERFORMER_TYPE_LABELS) as PerformerType[]).map((option) => (
              <SelectCard
                key={option}
                selected={type === option}
                label={PERFORMER_TYPE_LABELS[option]}
                onSelect={() => setType(option)}
                /* The same scene the homepage tile and the marketplace card
                   show, so somebody who pressed "Band" there recognises what
                   they picked here. It keeps its 4:3 box: cropping a scene to
                   a square cuts the ground out from under the figures. */
                art={<PerformerScene type={option} className="h-12 w-16" />}
              />
            ))}
          </CardGrid>
          {type === 'other' ? (
            <FloatField
              id="brief-type-other"
              label="What kind of act?"
              optional
              value={typeOther}
              maxLength={80}
              onChange={setTypeOther}
            />
          ) : null}

          <CardGrid label="Occasion">
            {(Object.keys(OCCASION_LABELS) as Occasion[]).map((option) => {
              const Icon = OCCASION_ICONS[option];
              return (
                <SelectCard
                  key={option}
                  selected={occasion === option}
                  label={OCCASION_LABELS[option]}
                  onSelect={() => setOccasion(option)}
                  art={
                    <span className="inline-flex size-12 items-center justify-center rounded-full bg-muted transition-colors duration-fast group-aria-pressed:bg-primary/15 motion-reduce:transition-none">
                      <Icon className="size-5" />
                    </span>
                  }
                />
              );
            })}
          </CardGrid>
          {occasion === 'other' ? (
            <FloatField
              id="brief-occasion-other"
              label="What is the occasion?"
              optional
              value={occasionOther}
              maxLength={80}
              onChange={setOccasionOther}
            />
          ) : null}
        </Section>

        <Section
          id="brief-place"
          index={2}
          title="Where and when?"
        >
          <div className="grid gap-block sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label htmlFor="brief-city" className="text-body-sm font-medium">
                City
              </label>
              {/* A real combobox, not a `datalist`. That element renders
                  NOTHING until somebody types, so a field beside nine chips
                  looked like it offered nine cities — which is exactly how it
                  was reported. The list opens on focus and filters as you
                  type, which is what the WAI-ARIA combobox pattern prescribes
                  and what the header's city switcher already does over the
                  same 186 rows.

                  Still free text: somebody in a town we do not list can type
                  it and be heard. The list is a shortcut, never a gate. */}
              <CityCombobox id="brief-city" value={city} onChange={setCity} />
              <ul className="flex flex-wrap gap-1.5 pt-1">
                {/* The chips stay the popular few — a hundred of them is a
                    wall, not a shortcut. Every other city is one press of the
                    field away, in a list that is visible rather than
                    implied. */}
                {POPULAR_CITIES.map((entry) => (
                  <li key={entry.name}>
                    <button
                      type="button"
                      onClick={() => setCity(entry.name)}
                      aria-pressed={city === entry.name}
                      className={cn(
                        // 44px on a phone, 32px from `sm` — the same treatment
                        // every chip row in this slice got.
                        'inline-flex min-h-control items-center rounded-full border px-3 text-caption transition-colors duration-fast sm:h-8 sm:min-h-0',
                        'motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        city === entry.name
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                      )}
                    >
                      {entry.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="brief-date" className="text-body-sm font-medium">
                Event date
              </label>
              {/* The same calendar the profile uses. `yearRange` is this year
                  and the next two — a booking further out than that is not a
                  date somebody is picking from a grid, and offering a hundred
                  years here would be as unhelpful as offering ten on a
                  birthday. */}
              <DayPicker
                id="brief-date"
                value={eventDate || null}
                onChange={setEventDate}
                min={today}
                yearRange={{ from: new Date().getFullYear(), to: new Date().getFullYear() + 2 }}
                placeholder="Pick the date"
              />
            </div>
          </div>
        </Section>

        <Section
          id="brief-budget"
          index={3}
          title="What is the budget?"
        >
          <BudgetRange
            min={budgetMin}
            max={budgetMax}
            onMin={setBudgetMin}
            onMax={setBudgetMax}
          />
        </Section>

        <Section
          id="brief-details"
          index={4}
          title="Anything else we should know?"
        >
          <div className="grid gap-block sm:grid-cols-[12rem_minmax(0,1fr)]">
            <FloatField
              id="brief-guests"
              label="Guests"
              optional
              inputMode="numeric"
              value={guests}
              onChange={(value) => setGuests(value.replace(/[^0-9]/g, ''))}
            />
          </div>
          <FloatArea
            id="brief-notes"
            label="Notes"
            optional
            rows={4}
            value={notes}
            onChange={setNotes}
            hint="Evening reception, outdoors, a mix of Hindi and English sets. PA system provided."
          />
        </Section>

        <Section
          id="brief-contact"
          index={5}
          title="How should we reach you?"
        >
          <div className="grid gap-block sm:grid-cols-2">
            <FloatField
              id="brief-contact-name"
              label="Name"
              value={contactName}
              maxLength={150}
              onChange={setContactName}
            />
            <FloatField
              id="brief-contact-phone"
              label="Phone"
              type="tel"
              value={contactPhone}
              maxLength={20}
              onChange={setContactPhone}
            />
          </div>
          <FloatField
            id="brief-contact-email"
            label="Email"
            type="email"
            value={contactEmail}
            onChange={setContactEmail}
          />
        </Section>

        {/* ── THE SEND ROW ────────────────────────────────────────────────
            The visible "Still needed: …" line was REMOVED at the owner's
            instruction, with the section blurbs, for a plainer form.

            What is left is `sr-only`, and that is not the same decision being
            quietly reversed. The line was drawn text; this is the accessible
            NAME of a disabled control, which is the one thing a person using a
            screen reader has instead of looking at the form and seeing the
            empty fields. Ship the button with nothing attached and it
            announces "Send enquiry, dimmed" and stops — WCAG 3.3.1 is about
            exactly that. It occupies no space and is never drawn. */}
        <div className="mt-block flex flex-col gap-4 border-t border-border pt-6">
          {missing.length ? (
            <p id="brief-missing" className="sr-only">
              Still needed: {missing.map((item) => item.label).join(', ')}.
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="text-body-sm text-muted-foreground">
              {error}
            </p>
          ) : null}

          {status === 'anonymous' ? (
            // Asked for at the END. A brief needs an owner to send the reply
            // back to, but asking before somebody has said what they want is
            // how a marketplace loses the people it is for.
            <Link
              href="/sign-in?next=%2Fhire"
              className="inline-flex h-control w-full items-center justify-center gap-1.5 rounded-xl bg-cta px-5 text-label text-cta-foreground transition-colors hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto sm:self-start"
            >
              Sign in to send this
            </Link>
          ) : (
            <button
              type="submit"
              disabled={!ready || create.isPending}
              aria-describedby={missing.length ? 'brief-missing' : undefined}
              className="inline-flex h-control w-full items-center justify-center gap-2 rounded-xl bg-cta px-6 text-label text-cta-foreground transition-colors hover:bg-cta-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto sm:self-start"
            >
              {create.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Send enquiry
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/**
 * Which section the reader is in, for the rail.
 *
 * An IntersectionObserver rather than a scroll handler: the browser does the
 * measuring off the main thread, and a `scroll` listener recomputing five
 * `getBoundingClientRect`s per frame is the classic way to make a long form
 * feel heavy on a phone.
 *
 * The root margin pins the "current" line near the TOP of the viewport
 * (-45% from the bottom), so a section becomes current as its heading arrives
 * rather than when it happens to occupy the most pixels — the latter makes a
 * tall section current while its title is still off screen above.
 */
function useActiveSection(): SectionId {
  const [active, setActive] = React.useState<SectionId>(SECTIONS[0].id);

  React.useEffect(() => {
    const nodes = SECTIONS.map((section) => document.getElementById(section.id)).filter(
      (node): node is HTMLElement => node !== null,
    );
    if (!nodes.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // The entries arrive unordered and only for what CHANGED, so the
        // decision is made over the live list rather than over this batch.
        const visible = nodes.filter((node) => {
          const entry = entries.find((candidate) => candidate.target === node);
          return entry ? entry.isIntersecting : node.dataset.briefVisible === 'true';
        });
        for (const node of nodes) {
          const entry = entries.find((candidate) => candidate.target === node);
          if (entry) node.dataset.briefVisible = String(entry.isIntersecting);
        }
        if (visible.length) setActive(visible[0].id as SectionId);
      },
      { rootMargin: '-80px 0px -45% 0px' },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return active;
}

/**
 * One question, with a number and a rule above it — never a bordered card.
 *
 * `scroll-mt` is what makes the rail's anchors land correctly: the site header
 * is sticky, so an un-offset `#hash` jump puts the heading underneath it.
 */
function Section({
  id,
  index,
  title,
  blurb,
  children,
}: {
  id: SectionId;
  index: number;
  title: string;
  /**
   * OPTIONAL, and every caller now omits it — the explanatory sentence under
   * each heading was removed at the owner's instruction for a plainer form.
   * The prop stays because the component is the shape of a section, not a
   * record of which ones currently have a subtitle.
   */
  blurb?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex scroll-mt-28 flex-col gap-6 border-border py-block first:pt-0 [&+section]:border-t"
    >
      <header className="flex items-start gap-3">
        <span
          className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-caption font-semibold tabular-nums text-primary"
          aria-hidden
        >
          {index}
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 id={`${id}-title`} className="text-h4">
            {title}
          </h2>
          {blurb ? <p className="max-w-prose text-body-sm text-muted-foreground">{blurb}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}

/**
 * A grid of selectable cards.
 *
 * ── THE GAP HAS TO BE A MARGIN ON THE LEGEND ────────────────────────────
 * A `<legend>` is the fieldset's CAPTION, not one of its flex items, so a
 * `gap-*` on the fieldset never applies to it. This was first "fixed" by
 * raising the gap, which changed the computed `row-gap` and moved nothing:
 * measured in the browser afterwards, the legend's bottom and the grid's top
 * were the same pixel, both before and after. `mb-3` is on the legend itself,
 * which does apply.
 */
function CardGrid({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col">
      <legend className="mb-3 text-body-sm font-medium">{label}</legend>
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">{children}</ul>
    </fieldset>
  );
}

/**
 * One card in that grid.
 *
 * The selected state is a tinted fill plus a soft `ring` in the brand accent —
 * a ring rather than a hand-written `box-shadow`, because the repo's own
 * `no-raw-values` lint refuses an arbitrary pixel value and is right to: a
 * glow spelled out in px is a token nobody can retheme. It is not a border
 * swap alone, which at 1px is invisible on a phone in daylight,
 * and not a fully saturated fill, which makes four chosen cards across the
 * form shout louder than the thing you came to press.
 *
 * `aria-pressed` carries the state to assistive tech AND drives the art's own
 * tint through `group-aria-pressed:`, so there is one source of truth for
 * "this is chosen" rather than a prop threaded into the icon.
 */
function SelectCard({
  selected,
  label,
  art,
  onSelect,
}: {
  selected: boolean;
  label: string;
  art: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          'group relative flex min-h-control w-full flex-col items-center gap-2 rounded-2xl border p-3 text-center',
          'transition-[background-color,border-color,box-shadow,transform] duration-fast',
          'motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          selected
            ? 'border-primary bg-primary/5 text-foreground ring-4 ring-primary/15'
            : 'border-border text-muted-foreground hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted hover:text-foreground hover:shadow-sm motion-reduce:hover:translate-y-0',
        )}
      >
        {/* A tick in the corner, because colour alone is not a state: the
            tinted fill is a low-contrast cue and this is the one that survives
            a colourblind reader and a bright phone screen. */}
        <span
          className={cn(
            'absolute right-2 top-2 inline-flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity duration-fast motion-reduce:transition-none',
            selected ? 'opacity-100' : 'opacity-0',
          )}
          aria-hidden
        >
          <Check className="size-2.5" />
        </span>
        {art}
        <span className="text-caption font-medium leading-tight sm:text-body-sm">{label}</span>
      </button>
    </li>
  );
}

/**
 * A floating-label input.
 *
 * The label starts inside the box and rises to a small line above the value
 * once there is one (or while the field has focus). The technique is
 * `placeholder-shown` on a field whose placeholder is a single space — NOT a
 * value-driven class, which would need this component to be stateful and
 * would drop the label for a browser autofill it never saw.
 *
 * The label element is real and `for`-associated either way, so this is a
 * presentation change and not an accessibility one: a screen reader announces
 * the same field it did when the label sat above the box.
 */
function FloatField({
  id,
  label,
  value,
  onChange,
  type = 'text',
  inputMode,
  maxLength,
  optional,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  type?: 'text' | 'tel' | 'email';
  inputMode?: 'numeric';
  maxLength?: number;
  optional?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <input
          id={id}
          type={type}
          inputMode={inputMode}
          value={value}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
          // One space, not an empty string: `:placeholder-shown` only matches
          // while a placeholder EXISTS, and an empty attribute is no
          // placeholder at all.
          placeholder=" "
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={cn(
            'peer h-14 w-full rounded-xl border border-border bg-background px-4 pb-1 pt-5 text-body-sm outline-none',
            'transition-colors duration-fast motion-reduce:transition-none',
            'hover:border-primary/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring',
          )}
        />
        <label
          htmlFor={id}
          className={cn(
            'pointer-events-none absolute left-4 top-1.5 text-caption text-muted-foreground',
            'transition-all duration-fast motion-reduce:transition-none',
            // Resting state: centred in the box at body size. It rises the
            // moment there is a value or the field takes focus.
            'peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-body-sm',
            'peer-focus:top-1.5 peer-focus:translate-y-0 peer-focus:text-caption peer-focus:text-primary',
          )}
        >
          {label}
          {optional ? <span className="text-muted-foreground"> — optional</span> : null}
        </label>
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-caption text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** The same floating label over a textarea. The label never travels to the
 *  vertical centre here — a four-row box would put it a long way from the
 *  caret — so it rests one line in and rises by a few pixels. */
function FloatArea({
  id,
  label,
  value,
  onChange,
  rows,
  optional,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  rows: number;
  optional?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <textarea
          id={id}
          rows={rows}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder=" "
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={cn(
            'peer w-full rounded-xl border border-border bg-background px-4 pb-3 pt-7 text-body-sm outline-none',
            'transition-colors duration-fast motion-reduce:transition-none',
            'hover:border-primary/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring',
          )}
        />
        <label
          htmlFor={id}
          className={cn(
            'pointer-events-none absolute left-4 top-2 text-caption text-muted-foreground',
            'transition-all duration-fast motion-reduce:transition-none',
            'peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-body-sm',
            'peer-focus:top-2 peer-focus:text-caption peer-focus:text-primary',
          )}
        >
          {label}
          {optional ? <span className="text-muted-foreground"> — optional</span> : null}
        </label>
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-caption text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Rupees as typed -> paise, which is what the API stores. */
function rupeesToMinor(value: string): number {
  const parsed = Number(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

/** ₹1,00,000 — Indian grouping, which is what every other price on this
 *  platform uses and what somebody reading their own budget expects. */
function formatRupees(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Two numbers rather than one, and it is worth saying why.
 *
 * A single figure invites every reply to be exactly it. A range says what is
 * comfortable and what is the ceiling, which is the conversation somebody is
 * actually trying to have — and it is what the API has always stored
 * (`budget_min_minor` / `budget_max_minor`); the form was the part that could
 * only offer five brackets.
 *
 * ── THE SLIDER IS A SECOND WAY IN, NEVER THE ONLY ONE ─────────────────────
 *
 * Two native `<input type="range">`, stacked, each a real labelled control —
 * so this is keyboard operable (arrows, Home/End), announced correctly, and
 * needs no pointer maths of its own. A custom two-thumb track drawn with
 * pointer events is how a budget control ends up unusable with a keyboard.
 *
 * The number fields stay, and they are the authority: the slider is capped at
 * ₹10,00,000 and a real budget is not, so a figure above the ceiling is typed
 * and the thumb simply rests at the end. Clamping the typed value to the
 * slider's range would be the five-band mistake wearing a new control.
 *
 * ── THE THUMBS CANNOT CROSS ───────────────────────────────────────────────
 *
 * Dragging the minimum past the maximum pushes the maximum along with it (and
 * the reverse), rather than being refused. A control that stops moving under
 * the finger reads as broken; one that carries its partner reads as intended,
 * and the "maximum is below the minimum" state stays reachable only by typing
 * — where it is stated in words.
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

  // What the TRACK shows when nothing has been chosen. The fields stay empty
  // — an untouched budget must not submit a number nobody picked — so these
  // are display positions only, and the first drag writes a real value.
  const minValue = min === '' ? SLIDER_MIN : clampToSlider(Number(min));
  const maxValue = max === '' ? SLIDER_MAX / 4 : clampToSlider(Number(max));

  const left = ((minValue - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100;
  const right = ((maxValue - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100;

  const dragMin = (next: number) => {
    onMin(String(next));
    if (next > maxValue) onMax(String(next));
  };
  const dragMax = (next: number) => {
    onMax(String(next));
    if (next < minValue) onMin(String(next));
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-h4 tabular-nums">
            {min === '' && max === '' ? (
              <span className="text-body-sm font-normal text-muted-foreground">
                Drag the handles, or type a range below
              </span>
            ) : (
              <>
                {formatRupees(Number(min || 0))}
                <span className="px-1.5 text-muted-foreground">–</span>
                {formatRupees(Number(max || 0))}
              </>
            )}
          </span>
        </div>

        {/* The track. Both inputs are transparent and stacked over it, so the
            painted bar is one element rather than two browser-specific
            pseudo-element recipes fighting each other. */}
        <div className="relative h-control">
          <span
            className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted"
            aria-hidden
          />
          <span
            className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary transition-[left,right] duration-fast motion-reduce:transition-none"
            style={{ left: `${Math.min(left, right)}%`, right: `${100 - Math.max(left, right)}%` }}
            aria-hidden
          />
          <RangeThumb
            id="brief-budget-slider-min"
            label="Minimum budget"
            value={minValue}
            onChange={dragMin}
          />
          <RangeThumb
            id="brief-budget-slider-max"
            label="Maximum budget"
            value={maxValue}
            onChange={dragMax}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { id: 'brief-budget-min', label: 'Minimum', value: min, onChange: onMin, hint: '10,000' },
          { id: 'brief-budget-max', label: 'Maximum', value: max, onChange: onMax, hint: '50,000' },
        ].map((field) => (
          <div key={field.id} className="flex flex-col gap-1.5">
            <label htmlFor={field.id} className="text-body-sm font-medium">
              {field.label}
            </label>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-4 transition-colors duration-fast hover:border-primary/40 focus-within:border-primary focus-within:ring-2 focus-within:ring-ring motion-reduce:transition-none">
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
        <p role="alert" className="text-caption text-muted-foreground">
          The maximum is below the minimum.
        </p>
      ) : null}
    </div>
  );
}

function clampToSlider(value: number): number {
  if (!Number.isFinite(value)) return SLIDER_MIN;
  return Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, value));
}

/**
 * One thumb of the pair.
 *
 * `pointer-events-none` on the input with `pointer-events-auto` on the THUMB
 * pseudo-element: two full-width stacked ranges would otherwise mean the upper
 * one swallows every press, including presses aimed at the lower one's thumb.
 * The input still takes focus and keyboard input, because focus does not go
 * through pointer events.
 */
function RangeThumb({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={SLIDER_MIN}
        max={SLIDER_MAX}
        step={SLIDER_STEP}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-valuetext={formatRupees(value)}
        className={cn(
          'pointer-events-none absolute inset-x-0 top-1/2 h-control w-full -translate-y-1/2 appearance-none bg-transparent',
          'focus-visible:outline-none',
          // The thumb, in both engines. Tailwind cannot express a
          // pseudo-element with a vendor prefix as a variant, so these are
          // arbitrary selectors — the one place in this file with them.
          '[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow-sm',
          '[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-6 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-background',
          'focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-ring',
          'focus-visible:[&::-moz-range-thumb]:ring-2 focus-visible:[&::-moz-range-thumb]:ring-ring',
        )}
      />
    </>
  );
}
