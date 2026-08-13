'use client';

import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@/components/ui';
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
  autoFocus?: boolean;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} value={label} count={max ? { used: value.length, max } : undefined} />
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
  rows = 6,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  /** Advisory, not enforced — the column is a TextField with no length cap. */
  softMax?: number;
  rows?: number;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor={id}
        value={label}
        count={softMax ? { used: value.length, max: softMax, soft: true } : undefined}
      />
      <Textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy || undefined}
        onChange={(event) => onChange(event.target.value)}
        className="resize-y"
      />
      <Messages id={id} hint={hint} error={error} />
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
      <Input
        id={id}
        type="datetime-local"
        value={value}
        min={min}
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
}: {
  htmlFor: string;
  value: string;
  count?: { used: number; max: number; soft?: boolean };
}) {
  const near = count ? count.used / count.max >= 0.8 : false;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <label htmlFor={htmlFor} className="text-body-sm font-medium text-foreground">
        {value}
      </label>
      {count ? (
        <span
          className={cn(
            'shrink-0 text-caption tabular-nums',
            // `warning-subtle-foreground`, never `text-warning`: the amber fill
            // token is 2.15:1 as text on a white page, which is the counter
            // becoming LESS readable exactly as it starts to matter.
            near ? 'text-warning-subtle-foreground' : 'text-muted-foreground',
          )}
        >
          {count.used}/{count.max}
          {count.soft ? ' suggested' : ''}
        </span>
      ) : null}
    </div>
  );
}

function Messages({ id, hint, error }: { id: string; hint?: string; error?: string }) {
  // One reserved line, so an error appearing does not shove the next field
  // down the page while someone is reading it.
  return (
    <p
      id={error ? `${id}-error` : `${id}-hint`}
      role={error ? 'alert' : undefined}
      className={cn('min-h-4 text-caption', error ? 'text-destructive' : 'text-muted-foreground')}
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
export function StepHeader({ title }: { title: string }) {
  return (
    <header className="flex flex-col gap-1.5">
      <h1 className="text-h3">{title}</h1>
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
        <p className="text-caption text-destructive" role="alert">
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
export function Section({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  count?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group rounded-xl border border-border bg-surface shadow-sm">
      <summary className="flex min-h-control cursor-pointer list-none items-center gap-3 rounded-xl px-card py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <span className="min-w-0 flex-1">
          <span className="block text-body-sm font-semibold">{title}</span>
        </span>
        {count ? (
          <span className="shrink-0 text-caption tabular-nums text-muted-foreground">{count}</span>
        ) : null}
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-fast group-open:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
      </summary>
      <div className="flex flex-col gap-stack-lg border-t border-border p-card">{children}</div>
    </details>
  );
}
