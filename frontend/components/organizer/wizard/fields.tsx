'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@/components/ui';
import { DayPicker } from '@/components/ui/day-picker';
import type { SaveState } from '@/lib/organizer/wizard/use-wizard';
import { cn } from '@/lib/utils/cn';

/**
 * The wizard's form primitives.
 *
 * Three things every field here does, which is why they are shared rather than
 * inlined per step:
 *
 * 1. **The error is wired to the input, not just printed near it.** A message
 *    in a `<p>` below an input is invisible to a screen reader unless
 *    `aria-describedby` points at it and `aria-invalid` marks the field — so
 *    both are always set here, and no step can forget.
 * 2. **The counter reserves its line whether or not it is shown.** A counter
 *    that appears at 80% of the limit pushes everything below it down by one
 *    line mid-typing, which is a layout shift on a form people are looking at.
 * 3. **The control itself is the shared `Input` / `Textarea` primitive**, not a
 *    class string copied into this directory. That is what keeps a field in the
 *    Studio the same height, radius, border token and focus ring as a field
 *    anywhere else in the product — including `border-input`, which is the one
 *    neutral stop that clears the 3:1 non-text requirement against BOTH a white
 *    surface and the dark ladder. A form's border is its only affordance, and a
 *    hairline is not enough of one.
 *
 * The invalid styling comes from the primitive's own `aria-[invalid=true]`
 * selector, so setting the ARIA attribute and colouring the border are the same
 * act and cannot drift apart.
 */

export function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  max,
  words,
  action,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  max?: number;
  /**
   * A word band to advise on, ALONGSIDE `max` rather than instead of it.
   *
   * `max` is the column and is enforced (`maxLength` on the input, an `Issue`
   * from `validate`). This is advice about the same text and is enforced
   * nowhere: it never sets `aria-invalid`, never blocks a save, and turns amber
   * rather than red. See `SHORT_DESCRIPTION_WORDS_MIN` for why the two
   * measurements are both worth showing.
   */
  words?: { count: number; min: number; max: number };
  /** A control that belongs to this field rather than to the form — a help
   *  modal's trigger, say. Sits on the label row so it cannot be mistaken for
   *  the step's own action. */
  action?: React.ReactNode;
  autoFocus?: boolean;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor={id}
        value={label}
        count={max ? { used: value.length, max } : undefined}
        words={words}
        action={action}
      />
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        maxLength={max}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <Messages id={id} hint={hint} error={error} />
    </div>
  );
}

export function TextArea({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  softMax,
  overHint,
  action,
  rows = 6,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  /**
   * Advisory, not enforced — the column is a TextField with no length cap.
   *
   * "Not enforced" is load-bearing and is why no `maxLength` is set below. The
   * `description` cap moved from 2000 to 1200, so drafts already exist between
   * the two: a `maxLength` here would have let the browser silently drop the
   * tail of somebody's saved copy on their next keystroke, and a blocking
   * `Issue` would have made those drafts unsavable over a number the API never
   * cared about. Going over is a warning, and only a warning.
   */
  softMax?: number;
  /** What to say once `softMax` is passed. Shown in place of `hint`, because
   *  the reason for the number is the only thing worth reading at that point. */
  overHint?: string;
  /** A control belonging to this field — see `TextField`'s own `action`. */
  action?: React.ReactNode;
  rows?: number;
}) {
  const over = Boolean(softMax && value.length > softMax);
  const describedBy = [hint || overHint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor={id}
        value={label}
        count={softMax ? { used: value.length, max: softMax, soft: true } : undefined}
        action={action}
      />
      <Textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        // `error` ONLY. An over-length description is not invalid — the server
        // takes it — so it must never mark the field, or a screen reader is
        // told a perfectly savable field is in error.
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy || undefined}
        onChange={(event) => onChange(event.target.value)}
        className="resize-y"
      />
      <Messages
        id={id}
        hint={over ? (overHint ?? hint) : hint}
        error={error}
        tone={over ? 'warning' : undefined}
      />
    </div>
  );
}

export function DateField({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  min,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  min?: string;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} value={label} />
      {/* The calendar for the date and a plain time input beside it, rather
          than one `datetime-local` — the native combined control is the least
          consistent widget on the platform, and splitting it is also what lets
          the date half use the design system's own picker.

          The value is still ONE `YYYY-MM-DDTHH:mm` string in and out, so
          nothing downstream learned about this. */}
      <div className="grid gap-2 sm:grid-cols-2">
        <DayPicker
          id={id}
          value={value ? value.slice(0, 10) : null}
          min={min ? min.slice(0, 10) : undefined}
          onChange={(day: string) => onChange(`${day}T${value.slice(11) || '00:00'}`)}
          placeholder="Pick a date"
        />
        <Input
          id={`${id}-time`}
          type="time"
          value={value.slice(11)}
          aria-label={`${label} — time`}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy || undefined}
          onChange={(event) =>
            onChange(`${value.slice(0, 10) || new Date().toISOString().slice(0, 10)}T${event.target.value}`)
          }
        />
      </div>
      <Messages id={id} hint={hint} error={error} />
    </div>
  );
}

/**
 * A plain date, and a plain time — two controls over ONE `datetime-local`.
 *
 * The single-day half of the schedule step. An organiser running one evening
 * answers "which day" once and "from when to when" twice, and asking for the
 * date a second time in the End field is a question whose answer they have
 * already given — and can get wrong, which is how an event ends the day before
 * it starts.
 *
 * ── WHY NOT SPLIT `Draft` INTO date AND time FIELDS ───────────────────────
 *
 * Because the API takes two datetimes and the model must not grow a shape only
 * one screen uses. The composition happens HERE, at the edge, and everything
 * downstream keeps seeing the `YYYY-MM-DDTHH:mm` string it always saw.
 *
 * `min` arrives as a `datetime-local` string and is SLICED for the date input.
 * A `type="date"` control silently ignores a `min` carrying a time — it does
 * not error, it just stops constraining, and the past quietly becomes
 * selectable again.
 */
export function DateTimeField({
  id,
  label,
  day,
  time,
  onChange,
  hint,
  error,
  min,
  timeLabel = 'Time',
}: {
  id: string;
  label: string;
  day: string;
  time: string;
  /** Called with both halves; the caller composes. */
  onChange: (next: { day: string; time: string }) => void;
  hint?: string;
  error?: string;
  /** A `datetime-local` string. Sliced to a date for the date input. */
  min?: string;
  timeLabel?: string;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} value={label} />
      {/* ── A REAL CALENDAR, NOT THE NATIVE DATE INPUT ───────────────────
          `<input type="date">` renders whatever the browser feels like: a grey
          `dd/mm/yyyy` with a system chevron on Android, something else on
          iOS, something else again on desktop — which is what made the
          schedule step look unfinished beside the rest of the form.

          `DayPicker` is the same control the Hire form and the performer
          profile already use, so this is the design system's calendar rather
          than a third one. It keeps the field free of a locale guess: the
          value is always `YYYY-MM-DD`, which is what the draft stores. */}
      <div className="grid gap-2 sm:grid-cols-2">
        <DayPicker
          id={id}
          value={day || null}
          min={min ? min.slice(0, 10) : undefined}
          onChange={(nextDay: string) => onChange({ day: nextDay, time })}
          placeholder="Pick a date"
        />
        <Input
          id={`${id}-time`}
          type="time"
          value={time}
          aria-label={`${label} — ${timeLabel}`}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy || undefined}
          onChange={(event) => onChange({ day, time: event.target.value })}
        />
      </div>
      <Messages id={id} hint={hint} error={error} />
    </div>
  );
}

/**
 * A time with no date — the End field while an event runs on one day.
 *
 * The date is the START's, composed by the caller. Offering a second date
 * picker in single-day mode would ask a question already answered, and a
 * mismatched pair is how an event ends before it begins.
 *
 * NO `min`. A time input's `min` is a wall-clock bound with no notion of the
 * day, so `min="19:00"` on an end time would refuse a midnight finish — the
 * ordering rule is a real comparison of two datetimes and it already lives in
 * `validate()`, which is where an error belongs.
 */
export function TimeOnlyField({
  id,
  label,
  value,
  onChange,
  hint,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} value={label} />
      <Input
        id={id}
        type="time"
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <Messages id={id} hint={hint} error={error} />
    </div>
  );
}

/**
 * A one-of-many field, wired the same way as the text ones.
 *
 * Radix's `Select` is not a native `<select>`, so `htmlFor` alone would not
 * name it — the label is bound with `aria-labelledby` on the trigger instead,
 * and clicking the label still focuses it because the trigger carries the id.
 */
export function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  hint,
  error,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} value={label} />
      {/* Radix refuses `value=""` (an empty string is how it clears a
          selection), so an unresolved choice is `undefined` — which is also
          what makes the placeholder show. */}
      <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy || undefined}
          className={cn(error && 'border-destructive')}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Messages id={id} hint={hint} error={error} />
    </div>
  );
}

function Label({
  htmlFor,
  value,
  count,
  words,
  action,
}: {
  htmlFor: string;
  value: string;
  count?: { used: number; max: number; soft?: boolean };
  words?: { count: number; min: number; max: number };
  action?: React.ReactNode;
}) {
  const near = count ? count.used / count.max >= 0.8 : false;
  // A SOFT cap can be passed; a hard one cannot, because the input's own
  // `maxLength` stops the keystroke at the boundary. So `over` only ever
  // describes advice, which is why it is amber and never red.
  const over = Boolean(count && count.used > count.max);
  return (
    <div className="flex items-baseline justify-between gap-3">
      <label htmlFor={htmlFor} className="text-body-sm font-medium text-foreground">
        {value}
      </label>
      <span className="flex shrink-0 items-baseline gap-2.5">
        {words ? <WordCount {...words} /> : null}
        {count ? (
          <span
            className={cn(
              'shrink-0 text-caption tabular-nums',
              // `warning-subtle-foreground`, never `text-warning`: the amber fill
              // token is 2.15:1 as text on a white page, which is the counter
              // becoming LESS readable exactly as it starts to matter.
              over
                ? 'font-medium text-warning-subtle-foreground'
                : near
                  ? 'text-warning-subtle-foreground'
                  : 'text-muted-foreground',
            )}
          >
            {count.used}/{count.max}
            {count.soft ? ' suggested' : ''}
          </span>
        ) : null}
        {action}
      </span>
    </div>
  );
}

/**
 * A live word count against a band.
 *
 * ── WHY IT IS WORDS AND NOT ANOTHER CHARACTER BAR ─────────────────────────
 *
 * The character counter beside it is the COLUMN — a hard stop the API shares.
 * This is editorial guidance about the same text, and words are the unit the
 * guidance is actually in: nobody writes a summary to a character budget, and
 * "15–30 words" is a sentence somebody can act on where "112/200" is not.
 *
 * Three states, never four: untouched, out of band, in band. `empty` renders
 * the band as a plain instruction rather than as a fault — a form that greets
 * an organiser by marking every field they have not reached yet is a form that
 * has told them off for arriving.
 *
 * Amber, never red, and no `aria-invalid` anywhere near it: this cannot block
 * a save and must not look like it can.
 */
function WordCount({ count, min, max }: { count: number; min: number; max: number }) {
  const state = count === 0 ? 'empty' : count < min || count > max ? 'out' : 'ok';
  return (
    <span
      className={cn(
        'shrink-0 text-caption tabular-nums transition-colors duration-fast motion-reduce:transition-none',
        state === 'ok'
          ? 'text-success-subtle-foreground'
          : state === 'out'
            ? 'text-warning-subtle-foreground'
            : 'text-muted-foreground',
      )}
    >
      {/* The band travels with the number, so the target is readable without
          hunting for a hint line underneath. */}
      {state === 'empty' ? `${min}–${max} words` : `${count} of ${min}–${max} words`}
      <span className="sr-only">
        {state === 'ok'
          ? ' — in the suggested range'
          : state === 'out'
            ? ' — outside the suggested range, which is a suggestion and will not stop you saving'
            : ''}
      </span>
    </span>
  );
}

function Messages({
  id,
  hint,
  error,
  tone,
}: {
  id: string;
  hint?: string;
  error?: string;
  /** Colours the HINT line. Deliberately separate from `error`: a warning is
   *  something to read, an error is something that stopped a save, and drawing
   *  them the same way is how people stop reading either. */
  tone?: 'warning';
}) {
  // One reserved line, so an error appearing does not shove the next field
  // down the page while someone is reading it.
  return (
    <p
      id={error ? `${id}-error` : `${id}-hint`}
      role={error ? 'alert' : undefined}
      className={cn(
        'min-h-4 text-caption',
        error
          ? 'text-foreground'
          : tone === 'warning'
            ? 'text-warning-subtle-foreground'
            : 'text-muted-foreground',
      )}
    >
      {error ?? hint ?? ''}
    </p>
  );
}

/** A step's heading block — one place, so every step has the same rhythm. */
/**
 * A label, somebody else's control, and the same wired message line.
 *
 * `VenueAutocomplete` is the one control in the Studio that is not an `Input`:
 * it owns a combobox, a listbox and its own state captions, so it cannot go
 * through `TextField`. Framing it here rather than hand-rolling a `<label>` and
 * a `<p>` in the step is what keeps its label, its counter and its error line
 * identical to the fields either side of it — and it hands back the id the
 * control must point `aria-describedby` at, so point 1 above still holds for a
 * control this file does not render.
 */
export function FieldFrame({
  id,
  label,
  count,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  count?: { used: number; max: number };
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} value={label} count={count} />
      {children}
      <Messages id={id} hint={hint} error={error} />
    </div>
  );
}

/** The id `FieldFrame` gives its message line, for the control's
 *  `aria-describedby`. Derived rather than passed, so the two cannot drift. */
export function fieldMessageId(id: string, error?: string): string {
  return error ? `${id}-error` : `${id}-hint`;
}

/**
 * A step's title, and nothing else.
 *
 * This used to take a `blurb` and render a paragraph under every heading —
 * "What people see first when browsing", "Where it happens. The city is what
 * people filter and search by". Thirteen of them across the wizard, restating
 * what the fields beneath already said.
 *
 * Prose under a heading is what a form reaches for when its labels, grouping
 * and order are not carrying their weight. The fix is the labels, grouping and
 * order — so the prop is gone rather than optional, and the compiler found
 * every call site.
 */
/**
 * The step's title, with the rule that separates it from its cards.
 *
 * A bare `h1` sat directly on the same background as the first card, so the
 * heading and the form it introduced read as one undifferentiated column. The
 * hairline gives the step a top edge without adding another box: the cards are
 * the boxes, and a card containing the title would make the heading look like
 * one more thing to open.
 *
 * `step` is the position, drawn as a small monospaced marker rather than
 * spelled out — "Basics" with a quiet 1 beside it says where you are without
 * repeating the rail above it in a sentence.
 */
export function StepHeader({ title, step }: { title: string; step?: number }) {
  return (
    <header className="flex flex-col gap-2 border-b border-border pb-block">
      <div className="flex items-center gap-2.5">
        {step ? (
          <span
            aria-hidden
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-caption font-semibold tabular-nums text-primary"
          >
            {step}
          </span>
        ) : null}
        <h1 className="text-h3">{title}</h1>
      </div>
    </header>
  );
}

/*
 * `NotStored` lived here: a dashed panel each wizard step rendered at its
 * foot, listing the columns the backend did not have and citing backlog items.
 *
 * It was built on a principle this codebase still holds — never draw a control
 * that discards what somebody types — but it applied that principle to the
 * wrong audience. The place to record why a field is absent is the code, not a
 * panel on the screen of somebody trying to publish an event. A tool that
 * narrates its own gaps reads as unfinished, and the notes rot: three of the
 * six were describing columns that had since been built.
 *
 * Absent is absent. If a field is missing, it is missing quietly.
 */

/** The save engine's health, as a server-backed step needs to know it. */
export type DraftSave = { state: SaveState; error: string | null };

/**
 * The panel a server-backed step shows before the draft exists.
 *
 * Gallery images, FAQs and the running order all hang off an event id, and
 * `POST /events` needs a title, venue, city and future start date before it
 * will issue one. So these steps genuinely cannot work yet — and the honest
 * response is a sentence saying which fields unlock them, not a disabled form
 * that looks broken or an upload that 404s.
 *
 * When nothing is missing, the closing line is the SaveBadge's truth rather
 * than a fixed "Saving now": a save that failed, or a browser that is offline,
 * used to render as "this unlocks in a moment" — a promise the engine already
 * knew it could not keep.
 */
export function NeedsSavedDraft({
  title,
  what,
  missing,
  save,
}: {
  title: string;
  what: string;
  missing: string[];
  /** Optional so callers without the wizard in reach keep working; absent, the
   *  optimistic line is all this panel can honestly say. */
  save?: DraftSave;
}) {
  return (
    <div className="flex flex-col gap-stack rounded-xl border border-dashed border-border bg-sunken p-card-lg">
      <p className="text-body-sm font-medium">{title}</p>
      <p className="max-w-prose text-body-sm text-muted-foreground">{what}</p>
      {missing.length ? (
        <ul className="flex flex-col gap-1">
          {missing.map((item) => (
            <li key={item} className="flex items-center gap-2 text-caption text-muted-foreground">
              <span className="size-1.5 shrink-0 rounded-full bg-border-strong" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      ) : save?.state === 'error' ? (
        <p className="text-caption text-muted-foreground" role="alert">
          {save.error ?? 'The last save failed.'} Your work is safe on this device.
        </p>
      ) : save?.state === 'offline' ? (
        <p className="text-caption text-warning-subtle-foreground">
          {save.error ?? 'You are offline — the draft saves itself when the connection returns.'}
        </p>
      ) : (
        <p className="text-caption text-muted-foreground">Saving now — this unlocks in a moment.</p>
      )}
    </div>
  );
}

/**
 * A collapsible group inside a step.
 *
 * Open by default and remembered per section: a collapsed-by-default form is
 * how a field nobody expands stays permanently empty. The summary line carries
 * the count so a collapsed section still says what is in it.
 *
 * The disclosure marker is a real icon rather than the `▸` character it used to
 * be — a text glyph picks up whatever the platform's emoji/symbol font decides,
 * which is why it rendered at a different size and baseline on every OS.
 */
/**
 * An always-open grouped card: an icon, a title, an optional aside, fields.
 *
 * ── WHY THIS EXISTS BESIDE `Section` ─────────────────────────────────────
 *
 * `Section` below is the same card with a `<details>` disclosure on it, and it
 * is right for the parts of a step somebody opens occasionally — sessions, the
 * running order, the lineup. The early steps are not like that: venue, city and
 * the schedule are the fields the step exists to collect, and putting them
 * behind a chevron would hide the required work of the form.
 *
 * They were previously ungrouped — a flat column of fields with `gap-block`
 * between them — which on a phone reads as one long undifferentiated form
 * where every field looks equally related to the one above it. Grouping says
 * which questions belong together, and it is the only structural difference
 * between the two components: SAME radius, border, shadow, header padding and
 * `p-card` body, so the two kinds of card cannot drift apart visually.
 *
 * `aside` is for a group-level control that belongs with the heading rather
 * than in the field list — a toggle over "how is this event run", say. It sits
 * in the header so it reads as governing the group beneath it.
 */
export function FieldGroup({
  title,
  icon,
  aside,
  children,
}: {
  title: string;
  /**
   * A rendered element, never a component reference. These steps are client
   * components today, but every other icon prop in this codebase takes an
   * element for the reason `buildDisclosures` documents — a function cannot
   * cross a server boundary, and it fails by taking the whole page down.
   */
  icon?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface shadow-sm">
      <header className="flex min-h-control items-center gap-2.5 px-card py-3">
        {icon ? (
          <span className="shrink-0 text-primary" aria-hidden>
            {icon}
          </span>
        ) : null}
        <h3 className="min-w-0 flex-1 text-body-sm font-semibold text-foreground">{title}</h3>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </header>
      <div className="flex flex-col gap-stack-lg border-t border-border p-card">{children}</div>
    </section>
  );
}

/**
 * THE TOGGLE CARD — one switch, one section, closed until it is turned on.
 *
 * ── A SWITCH, NOT A CHEVRON ──────────────────────────────────────────────
 *
 * This was a `<details>` disclosure with a chevron. The owner asked for a
 * TOGGLE: flip it on and the section opens, flip it off and it closes. So the
 * affordance is a switch track and the whole header is the control.
 *
 * ── WHY IT IS STILL A DISCLOSURE UNDERNEATH ──────────────────────────────
 *
 * `role="switch"` announces "on/off", which is what a setting is. This does
 * not CHANGE anything about the event — it reveals fields that were always
 * going to be saved. A screen-reader user told "Tags, switch, off" would
 * reasonably conclude tags are disabled; `aria-expanded` says "collapsed",
 * which is the truth. So it is a `<button aria-expanded>` wearing a switch,
 * and the two audiences each get the right answer.
 *
 * It also cannot be a `<details>` any more: a nested interactive control
 * inside `<summary>` is undefined behaviour in several browsers, and the
 * switch has to sit in the header.
 *
 * ── CLOSED BY DEFAULT, AND A CLOSED CARD STILL SPEAKS ────────────────────
 *
 * `count` is what makes collapsing safe. A closed card that holds a value says
 * so — "3", "Set", the title itself — so the step reads as a summary of the
 * event rather than a row of shut doors. `invalid` marks a section with a
 * problem, because "closed by default" plus "errors on save" would otherwise
 * combine into a form that refuses to submit and shows nothing anywhere.
 *
 * `defaultOpen` survives for the one case that earns it: a section holding a
 * single control, where collapsing hides a field behind a press that reveals
 * a field.
 */
export function AccordionCard({
  title,
  count,
  children,
  defaultOpen = false,
  invalid = false,
  required = false,
}: {
  title: string;
  /** The quiet right-hand figure — "3 of 10", "Set", "Required". */
  count?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Draws the header as failing. Does NOT force it open — see the note. */
  invalid?: boolean;
  required?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const bodyId = React.useId();

  return (
    <section
      className={cn(
        // ── THE TICKET SHAPE ──────────────────────────────────────────
        // `rounded-2xl` and a hairline, with the perforation drawn as a
        // gradient stripe on the left edge when the card is open — the same
        // language the issued ticket and the checkout cards use, so an
        // organizer's form looks like the thing they are making.
        'group/card relative overflow-hidden rounded-2xl border bg-surface',
        'transition-[border-color,box-shadow] duration-base motion-reduce:transition-none',
        invalid
          ? 'border-destructive/50 shadow-sm'
          : open
            ? 'border-primary/30 shadow-md'
            : 'border-border shadow-sm hover:border-primary/25',
      )}
    >
      {/* The stub edge. Purely decorative, and only while open, so a closed
          list of cards stays quiet. */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 left-0 w-1 transition-opacity duration-base motion-reduce:transition-none',
          'bg-gradient-to-b from-primary/60 via-primary/20 to-transparent',
          open ? 'opacity-100' : 'opacity-0',
        )}
      />

      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex w-full min-h-control items-center gap-3 px-card py-3.5 text-left',
          'transition-colors duration-fast hover:bg-muted/50 motion-reduce:transition-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-body-sm font-semibold text-foreground">
            {title}
            {required ? (
              <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-caption font-medium text-destructive">
                Required
              </span>
            ) : null}
          </span>
        </span>

        {invalid ? (
          <AlertTriangle className="size-4 shrink-0 text-destructive" aria-label="Needs attention" />
        ) : count ? (
          <span className="shrink-0 truncate text-caption tabular-nums text-muted-foreground">
            {count}
          </span>
        ) : null}

        {/* The switch, drawn rather than mounted: a real `<Switch>` here would
            be a control inside a control, and a press would have to decide
            which one it meant. The state is the button's own. */}
        <span
          aria-hidden
          className={cn(
            'inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent px-0.5',
            'transition-colors duration-fast motion-reduce:transition-none',
            open ? 'bg-primary' : 'bg-input',
          )}
        >
          <span
            className={cn(
              'block size-5 rounded-full bg-surface shadow-sm',
              'transition-transform duration-fast ease-out motion-reduce:transition-none',
              open ? 'translate-x-5' : 'translate-x-0',
            )}
          />
        </span>
      </button>

      <div id={bodyId} hidden={!open} className="border-t border-border p-card">
        <div className="flex flex-col gap-stack-lg">{children}</div>
      </div>
    </section>
  );
}

/**
 * The name every existing call site uses. `AccordionCard` is the same
 * component — this alias is why "every section becomes a toggle" was one
 * component changing rather than twenty imports.
 */
export const Section = AccordionCard;
