'use client';

import * as React from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * A repeatable list of single-line points.
 *
 * Used three times — what a ticket includes, what it does not, and the rules
 * for turning up. One component rather than three, because the interaction is
 * identical and the three would drift.
 *
 * ── WHY IT IS NOT `PolicyEditor` ──────────────────────────────────────────
 *
 * That one edits `{title, body}` pairs and is right for what it does: a policy
 * is a NAMED rule with a paragraph under it ("Refunds — up to 48 hours
 * before…"). These are single facts somebody scans ("Two rounds of chai"), and
 * forcing a heading onto each would make an organiser invent titles for
 * one-line points. Same repeatable shape, different content, different field.
 *
 * ── THE INDEX IS THE KEY, AND THAT IS SAFE HERE ───────────────────────────
 *
 * A list keyed by index is normally a bug: React reuses the DOM node, so
 * deleting the first of three rows leaves the second row's input holding the
 * first's text. It is safe in THIS shape because a row is one uncontrolled
 * concern — a single input whose entire value comes from the array — so a
 * reused node re-renders with the right string. `PolicyEditor` next door
 * carries a `key` on each row precisely because it has two fields and can
 * reorder.
 *
 * ── BLANK ROWS ARE THE ORGANISER'S TO LEAVE ───────────────────────────────
 *
 * Nothing here refuses an empty row or trims on blur. The server drops blanks
 * and collapses duplicates, `toPatchInput` cleans identically on the way out,
 * so an empty row is invisible to everyone downstream. Policing it in the UI
 * would mean a field that erases itself while somebody is still deciding what
 * to type in it.
 */

export type BulletListEditorProps = {
  id: string;
  label: string;
  /** One line under the label. Say what belongs here, not that it is optional. */
  hint?: string;
  placeholder?: string;
  value: string[];
  onChange: (next: string[]) => void;
  /** Matches the server's cap so the control cannot ask for a refused save. */
  max: number;
  /** The label on the add button — "Add a point" reads oddly for guidelines. */
  addLabel?: string;
};

export function BulletListEditor({
  id,
  label,
  hint,
  placeholder,
  value,
  onChange,
  max,
  addLabel = 'Add point',
}: BulletListEditorProps) {
  // Focus the row that was just added, so adding three points is three presses
  // and three bursts of typing rather than a press-and-reach each time.
  const pendingFocus = React.useRef<number | null>(null);
  const rowRefs = React.useRef<(HTMLInputElement | null)[]>([]);

  React.useEffect(() => {
    const index = pendingFocus.current;
    if (index === null) return;
    pendingFocus.current = null;
    rowRefs.current[index]?.focus();
  }, [value.length]);

  const setAt = (index: number, text: string) => {
    const next = [...value];
    next[index] = text;
    onChange(next);
  };

  const removeAt = (index: number) => {
    onChange(value.filter((_, position) => position !== index));
  };

  const add = () => {
    pendingFocus.current = value.length;
    onChange([...value, '']);
  };

  const full = value.length >= max;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="contents">
        <Label htmlFor={`${id}-0`}>{label}</Label>
      </legend>
      {hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}

      {value.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {value.map((point, index) => (
            // eslint-disable-next-line react/no-array-index-key -- see the note
            // in this file's docstring: a row is one input whose whole value
            // comes from the array, so a reused node re-renders correctly.
            <li key={index} className="flex items-center gap-2">
              <Input
                id={`${id}-${index}`}
                ref={(node) => {
                  rowRefs.current[index] = node;
                }}
                value={point}
                onChange={(event) => setAt(index, event.target.value)}
                onKeyDown={(event) => {
                  // Enter adds the next point instead of submitting the form —
                  // this list is written in one burst, and reaching for the
                  // mouse between every line is what makes people stop at two.
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    if (!full) add();
                  }
                }}
                placeholder={placeholder}
                aria-label={`${label}, point ${index + 1}`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeAt(index)}
                aria-label={`Remove point ${index + 1}`}
                className="shrink-0"
              >
                <X className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          disabled={full}
          className="w-fit gap-1.5"
        >
          <Plus className="size-4" aria-hidden />
          {addLabel}
        </Button>
        {/* The ceiling is stated only once it is REACHED. A permanent "0 of 8"
            turns an optional list into a quota, which is the opposite of what
            an optional field should feel like. */}
        {full ? (
          <p className="text-caption text-muted-foreground">
            That is the maximum ({max}). Remove one to add another.
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}
