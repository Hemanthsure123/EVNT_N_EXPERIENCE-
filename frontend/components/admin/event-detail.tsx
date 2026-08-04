'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Save, Trash2, TriangleAlert } from 'lucide-react';
import { deleteAdminEvent, fetchAdminEventAnalytics, updateAdminEvent } from '@/lib/api/admin';
import { fetchEventDetail } from '@/lib/api/events';
import { ApiError } from '@/lib/api/errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { TrendChart } from '@/components/admin/charts';
import { ErrorState, Panel, Skeleton, StatusPill } from '@/components/organizer/primitives';
import { formatEventDateLong, formatMoney } from '@/lib/discovery/format';
import { cn } from '@/lib/utils/cn';

/**
 * One event, as an operator.
 *
 * ── IT SHOWS THE ORGANIZER'S OWN NUMBERS ──────────────────────────────────
 *
 * The analytics here come from `GET /admin/events/{id}/analytics`, which
 * delegates to the organizer module's own selector. That is the point: an
 * operator answering "my revenue looks wrong" has to be reading the SAME
 * figures the organizer is reading. A console-shaped reimplementation would
 * eventually disagree, and the support conversation would become an argument
 * about which screen to believe.
 *
 * ── THE TWO WRITES ARE DRAWN AT VERY DIFFERENT WEIGHTS ────────────────────
 *
 * Editing is reversible and routine; deleting is neither. So Save is the one
 * filled pill, and Delete lives below a rule in its own bordered block, is a
 * quiet ghost until hover, and requires the event's title typed back before it
 * arms. That is the same escalation the organizer's own destructive actions
 * use, and it is deliberate that the two are not adjacent lookalikes — an
 * operator working quickly must not be one misclick from removing an event.
 *
 * ── THE EDIT CARRIES THE VERSION IT IS BASED ON ───────────────────────────
 *
 * Events are optimistically locked. The form seeds its version from the read
 * and sends it back with the write, so an operator editing a row an organizer
 * is also editing gets a 409 rather than silently clobbering them — and the
 * 409 offers a RELOAD, never a retry, because retrying a conditional update
 * with a refreshed version is exactly how the lock gets defeated.
 */

const EDITABLE = [
  { key: 'title', label: 'Title', kind: 'text' },
  { key: 'venue', label: 'Venue', kind: 'text' },
  { key: 'city', label: 'City', kind: 'text' },
  { key: 'short_description', label: 'Short description', kind: 'text' },
  { key: 'description', label: 'Description', kind: 'area' },
] as const;

type EditableKey = (typeof EDITABLE)[number]['key'];

export function AdminEventDetail({ eventId }: { eventId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const event = useQuery({
    queryKey: ['admin', 'event', eventId],
    queryFn: () => fetchEventDetail(eventId),
  });

  const analytics = useQuery({
    queryKey: ['admin', 'event-analytics', eventId],
    queryFn: () => fetchAdminEventAnalytics(eventId),
  });

  const [form, setForm] = React.useState<Record<EditableKey, string> | null>(null);
  const [saveError, setSaveError] = React.useState<unknown>(null);
  const [confirmText, setConfirmText] = React.useState('');
  const [deleteReason, setDeleteReason] = React.useState('');
  const [deleteError, setDeleteError] = React.useState<unknown>(null);

  // Seed the form ONCE the event lands. Re-seeding on every render would
  // discard what the operator is typing on each background refetch.
  React.useEffect(() => {
    if (!event.data || form) return;
    setForm({
      title: event.data.title,
      venue: event.data.venue,
      city: event.data.city,
      short_description: event.data.short_description ?? '',
      description: event.data.description ?? '',
    });
  }, [event.data, form]);

  const save = useMutation({
    mutationFn: () => {
      if (!event.data || !form) throw new Error('not ready');
      return updateAdminEvent(eventId, event.data.version, form);
    },
    onSuccess: () => {
      setSaveError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'event', eventId] });
    },
    onError: (thrown) => setSaveError(thrown),
  });

  const remove = useMutation({
    mutationFn: () => deleteAdminEvent(eventId, deleteReason.trim()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
      router.push('/admin/moderation');
    },
    onError: (thrown) => setDeleteError(thrown),
  });

  if (event.isPending) {
    return (
      <div className="flex flex-col gap-block">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (event.isError || !event.data) {
    return <ErrorState message="Could not load this event." onRetry={() => void event.refetch()} />;
  }

  const detail = event.data;
  const stats = analytics.data;
  const dirty =
    form !== null &&
    EDITABLE.some((field) => form[field.key] !== ((detail[field.key] as string) ?? ''));
  const armed = confirmText.trim() === detail.title.trim() && deleteReason.trim().length > 0;

  return (
    <div className="flex flex-col gap-block">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            href="/admin/moderation"
            className="inline-flex w-fit items-center gap-1.5 rounded-sm text-caption text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Moderation
          </Link>
          <h1 className="truncate text-h3">{detail.title}</h1>
          <p className="text-caption text-muted-foreground">
            {detail.venue}, {detail.city} · {formatEventDateLong(detail.starts_at)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill tone={detail.status === 'live' ? 'success' : 'neutral'}>
            {detail.status.replace('_', ' ')}
          </StatusPill>
          {/* The public page, for an operator checking what a visitor sees.
              Only offered when it IS public — a link to a draft's URL would
              404 for the person following it. */}
          {detail.status === 'live' ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/events/${detail.id}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-3.5" aria-hidden />
                View live
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {/* ── The organizer's own numbers ─────────────────────────────────── */}
      <Panel title="Performance" subtitle="The organizer's own figures, not a second calculation">
        {analytics.isPending ? (
          <div className="grid gap-3 p-card sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : analytics.isError || !stats ? (
          <ErrorState
            message="Could not load analytics for this event."
            onRetry={() => void analytics.refetch()}
          />
        ) : (
          <div className="flex flex-col gap-block p-card">
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Revenue" value={formatMoney(stats.revenue_minor)} />
              <Stat label="Sold" value={`${stats.sold} / ${stats.capacity || '—'}`} />
              <Stat
                label="Sell-through"
                value={stats.sell_through_pct === null ? '—' : `${stats.sell_through_pct}%`}
              />
              <Stat label="Checked in" value={String(stats.checkins)} />
            </dl>

            {stats.sales_timeline.length ? (
              <TrendChart
                points={stats.sales_timeline}
                label="Sales"
                format={(value) => formatMoney(value)}
              />
            ) : (
              // No row is not zero. An event that has not gone on sale has no
              // series to draw, and a flat line at zero would read as "nobody
              // is buying" rather than "nothing could be bought yet".
              <p className="text-body-sm text-muted-foreground">
                No sales yet — there is nothing to chart.
              </p>
            )}

            {stats.tiers.length ? (
              <div className="flex flex-col gap-2">
                <p className="text-label uppercase tracking-wide text-foreground-subtle">
                  By ticket type
                </p>
                <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                  {stats.tiers.map((tier) => (
                    <li
                      key={tier.name}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-body-sm"
                    >
                      <span className="truncate">{tier.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {tier.sold} / {tier.quantity}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </Panel>

      {/* ── Edit ────────────────────────────────────────────────────────── */}
      <Panel title="Edit" subtitle="Takes the same optimistic lock an organizer's own edit takes">
        <div className="flex flex-col gap-stack-lg p-card">
          {form
            ? EDITABLE.map((field) => (
                <div key={field.key} className="flex flex-col gap-2">
                  <Label htmlFor={`edit-${field.key}`}>{field.label}</Label>
                  {field.kind === 'area' ? (
                    <Textarea
                      id={`edit-${field.key}`}
                      rows={5}
                      value={form[field.key]}
                      onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                    />
                  ) : (
                    <Input
                      id={`edit-${field.key}`}
                      value={form[field.key]}
                      onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                    />
                  )}
                </div>
              ))
            : null}

          {saveError ? <WriteError thrown={saveError} /> : null}

          <div className="flex items-center gap-3">
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
              <Save className="size-4" aria-hidden />
              Save changes
            </Button>
            {save.isSuccess && !dirty ? (
              <span className="text-caption text-success-subtle-foreground">Saved.</span>
            ) : null}
          </div>
        </div>
      </Panel>

      {/* ── Delete ──────────────────────────────────────────────────────── */}
      <Panel
        title="Delete this event"
        subtitle="Refused while anybody holds a ticket or is mid-checkout"
      >
        <div className="flex flex-col gap-stack-lg p-card">
          <p className="max-w-prose text-body-sm text-muted-foreground">
            Deleting removes the event from every listing and page. It is refused outright if the
            event has any booking that is not a lapsed hold — a ticket whose event no longer
            resolves is worse than an event that stayed up. To stop sales on an event people have
            already bought into, take it off sale instead and refund from Payments.
          </p>

          <div className="flex flex-col gap-2">
            <Label htmlFor="delete-reason">Reason (recorded in the audit log)</Label>
            <Input
              id="delete-reason"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="e.g. duplicate listing"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="delete-confirm">
              Type <span className="font-semibold text-foreground">{detail.title}</span> to confirm
            </Label>
            <Input
              id="delete-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
            />
          </div>

          {deleteError ? <WriteError thrown={deleteError} /> : null}

          <Button
            variant="ghost"
            onClick={() => remove.mutate()}
            loading={remove.isPending}
            disabled={!armed}
            className={cn(
              'w-fit border border-destructive-subtle text-destructive-subtle-foreground',
              'hover:bg-destructive-subtle',
            )}
          >
            <Trash2 className="size-4" aria-hidden />
            Delete event
          </Button>
        </div>
      </Panel>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-sunken p-card">
      <dt className="text-caption uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-h4 tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * The server's own sentence, with a reload offered on a stale version.
 *
 * A 409 must never be retried with a refreshed version — that is precisely how
 * the edit the lock just protected gets clobbered. The only safe offer is to
 * re-read and start from what is actually stored.
 */
function WriteError({ thrown }: { thrown: unknown }) {
  const stale = thrown instanceof ApiError && thrown.code === 'stale_event_version';
  const message =
    thrown instanceof ApiError
      ? thrown.message
      : 'Something went wrong. Nothing was changed — try again.';

  return (
    <p
      role="alert"
      className="flex items-start gap-2.5 rounded-lg border border-destructive-subtle bg-destructive-subtle px-4 py-3 text-body-sm text-destructive-subtle-foreground"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {stale
          ? 'This event changed somewhere else while you were editing. Reload to start from the current version.'
          : message}
        {stale ? (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="ml-2 font-medium underline underline-offset-2"
          >
            Reload
          </button>
        ) : null}
      </span>
    </p>
  );
}
