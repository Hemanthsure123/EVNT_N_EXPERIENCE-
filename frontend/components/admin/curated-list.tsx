'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Eye, EyeOff, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusPill } from '@/components/organizer/primitives';
import { errorMessage } from '@/lib/api/errors';
import { cn } from '@/lib/utils/cn';

/**
 * The editor behind "Featured cities" and "Popular searches".
 *
 * ONE component for both, because they are the same object: an ORDERED list of
 * short rows an operator curates, each with a couple of text fields, a
 * position and a visible flag. Two near-identical editors is how the reorder
 * logic ends up fixed in one of them and not the other.
 *
 * ── ORDER IS THE POINT, SO IT IS THE PRIMARY AFFORDANCE ──────────────────
 *
 * Both lists are ranked — position 0 is the first tile a visitor sees. So the
 * control is a pair of move buttons on every row, not a `position` number
 * field. A number field makes the operator do the arithmetic and lets two rows
 * hold the same position; buttons cannot express an invalid state.
 *
 * Drag-and-drop was considered and rejected: these lists are six to ten rows,
 * it is unusable by keyboard without building a parallel control anyway, and
 * the buttons are already accessible.
 *
 * ── HIDDEN IS A LABEL, NOT A DIMMER ───────────────────────────────────────
 *
 * A hidden row used to be drawn at 60% opacity, which produces a contrast
 * ratio nobody can verify and asks the operator to infer a state from a
 * shade. It carries a "Hidden" pill instead: the same fact, readable, and it
 * survives being printed, screenshotted or read aloud.
 *
 * ── THE DESTRUCTIVE CONTROL IS NOT IN THE ROW OF ROUTINE ONES ─────────────
 *
 * Move up, move down and hide are all reversible; remove is not. It sits after
 * a hairline divider so a fast hand travelling along the cluster does not
 * arrive at it by momentum.
 */

export type CuratedRow = {
  id: string;
  position: number;
  is_visible: boolean;
};

type FieldSpec<T> = {
  key: keyof T & string;
  label: string;
  placeholder: string;
  hint?: string;
  required?: boolean;
};

export function CuratedListEditor<T extends CuratedRow>({
  queryKey,
  fetchAll,
  create,
  update,
  remove,
  fields,
  title,
  blurb,
  addLabel,
  primaryField,
}: {
  queryKey: string[];
  fetchAll: () => Promise<{ data: T[] }>;
  create: (input: Record<string, unknown>) => Promise<T>;
  update: (id: string, input: Record<string, unknown>) => Promise<T>;
  remove: (id: string) => Promise<void>;
  fields: FieldSpec<T>[];
  title: string;
  blurb: string;
  addLabel: string;
  /** The field shown as the row's name. */
  primaryField: keyof T & string;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);

  const rows = useQuery({ queryKey, queryFn: fetchAll });
  const items = React.useMemo(
    () => [...(rows.data?.data ?? [])].sort((a, b) => a.position - b.position),
    [rows.data],
  );

  const invalidate = () => {
    void client.invalidateQueries({ queryKey });
    // The public page reads these from the homepage payload, which the backend
    // invalidates on commit. Dropping the client's copy too means the operator
    // sees their change in the preview without a reload.
    void client.invalidateQueries({ queryKey: ['homepage'] });
  };

  const onError = (thrown: unknown) => setError(errorMessage(thrown));

  const createRow = useMutation({
    mutationFn: create,
    onSuccess: () => {
      setDraft({});
      setError(null);
      invalidate();
    },
    onError,
  });

  const updateRow = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Record<string, unknown> }) =>
      update(id, input),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError,
  });

  const removeRow = useMutation({ mutationFn: remove, onSuccess: invalidate, onError });

  /**
   * Swap two rows' positions.
   *
   * Both writes go out, and only when both land does the list re-fetch — a
   * single write would leave two rows sharing a position, which the list then
   * orders arbitrarily.
   */
  const move = async (index: number, direction: -1 | 1) => {
    const row = items[index];
    const neighbour = items[index + direction];
    if (!row || !neighbour) return;
    await Promise.all([
      update(row.id, { position: neighbour.position }),
      update(neighbour.id, { position: row.position }),
    ]).catch(onError);
    invalidate();
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const input: Record<string, unknown> = { position: items.length };
    for (const field of fields) input[field.key] = (draft[field.key] ?? '').trim();
    createRow.mutate(input);
  };

  const canSubmit = fields
    .filter((field) => field.required !== false)
    .every((field) => (draft[field.key] ?? '').trim().length > 0);

  return (
    <section className="flex flex-col gap-block" aria-label={title}>
      <header className="flex flex-col gap-stack">
        <h2 className="text-h4">{title}</h2>
        <p className="text-body-sm text-muted-foreground">{blurb}</p>
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive-subtle bg-destructive-subtle px-card py-2 text-body-sm text-destructive-subtle-foreground"
        >
          {error}
        </p>
      ) : null}

      {rows.isPending ? (
        <p className="flex items-center gap-2 text-body-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading…
        </p>
      ) : items.length === 0 ? (
        // Absent, not an empty grid: a list with nothing in it is a legitimate
        // state (an operator can clear it), and it should read as one.
        <p className="rounded-xl border border-dashed border-border px-card py-block text-center text-body-sm text-muted-foreground">
          Nothing here yet. The section is hidden from the site until you add one.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {items.map((row, index) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-stack rounded-xl border border-border bg-surface px-card py-2"
            >
              <span className="w-6 shrink-0 text-right text-caption tabular-nums text-muted-foreground">
                {index + 1}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 truncate text-label text-foreground">
                    {String(row[primaryField])}
                  </span>
                  {!row.is_visible ? <StatusPill tone="neutral">Hidden</StatusPill> : null}
                </span>
                {fields.length > 1 ? (
                  <span className="block truncate text-caption text-muted-foreground">
                    {fields
                      .filter((field) => field.key !== primaryField)
                      .map((field) => String(row[field.key] ?? ''))
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                ) : null}
              </span>

              <span className="ml-auto flex shrink-0 items-center gap-0.5">
                <IconButton
                  label={`Move ${String(row[primaryField])} up`}
                  disabled={index === 0}
                  onClick={() => void move(index, -1)}
                >
                  <ArrowUp className="size-4" aria-hidden />
                </IconButton>
                <IconButton
                  label={`Move ${String(row[primaryField])} down`}
                  disabled={index === items.length - 1}
                  onClick={() => void move(index, 1)}
                >
                  <ArrowDown className="size-4" aria-hidden />
                </IconButton>
                <IconButton
                  // Hiding is REVERSIBLE and deleting is not, so hiding is the
                  // control an operator reaches for first.
                  label={row.is_visible ? `Hide ${String(row[primaryField])}` : `Show ${String(row[primaryField])}`}
                  onClick={() =>
                    updateRow.mutate({ id: row.id, input: { is_visible: !row.is_visible } })
                  }
                >
                  {row.is_visible ? (
                    <Eye className="size-4" aria-hidden />
                  ) : (
                    <EyeOff className="size-4" aria-hidden />
                  )}
                </IconButton>

                {/* Reversible actions, then a hairline, then the one that is
                    not. Nobody should reach Remove by momentum. */}
                <span className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden />

                <IconButton
                  label={`Remove ${String(row[primaryField])}`}
                  destructive
                  onClick={() => removeRow.mutate(row.id)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </IconButton>
              </span>
            </li>
          ))}
        </ol>
      )}

      <form
        onSubmit={submit}
        className="flex flex-col gap-block rounded-xl border border-border bg-surface p-card"
      >
        <h3 className="text-label text-foreground">{addLabel}</h3>
        <div className="grid gap-block sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.key} className="flex flex-col gap-stack">
              <Label htmlFor={`curated-${field.key}`}>{field.label}</Label>
              <Input
                id={`curated-${field.key}`}
                value={draft[field.key] ?? ''}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, [field.key]: event.target.value }))
                }
                placeholder={field.placeholder}
              />
              {field.hint ? (
                <p className="text-caption text-muted-foreground">{field.hint}</p>
              ) : null}
            </div>
          ))}
        </div>
        <div>
          {/* The one filled action on this editor. */}
          <Button
            type="submit"
            disabled={!canSubmit || createRow.isPending}
            loading={createRow.isPending}
            leftIcon={<Plus className="size-4" aria-hidden />}
          >
            {createRow.isPending ? 'Adding…' : addLabel}
          </Button>
        </div>
      </form>
    </section>
  );
}

/**
 * A row action. The shared `<Button>` in its `icon` size, so every one of these
 * is a full 44px target rather than a 32px hit box in a list somebody is
 * working through quickly.
 */
function IconButton({
  label,
  onClick,
  disabled,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      // The icon carries no text, so the accessible name comes from here and
      // names the ROW as well as the action — "Move up" alone is ambiguous in
      // a list of ten.
      aria-label={label}
      title={label}
      className={cn(
        'text-muted-foreground',
        destructive
          ? 'hover:bg-destructive-subtle hover:text-destructive-subtle-foreground'
          : 'hover:text-foreground',
      )}
    >
      {children}
    </Button>
  );
}
