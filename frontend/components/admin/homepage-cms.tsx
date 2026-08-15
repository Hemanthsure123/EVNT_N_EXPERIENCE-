'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowDown, ArrowUp, Check, Save } from 'lucide-react';
import {
  archiveCategory,
  fetchAdminCategories,
  fetchHomepageDraft,
  updateCategory,
  updateHomepage,
  type AdminCategory,
} from '@/lib/api/cms';
import { ApiError } from '@/lib/api/errors';
import { EmptyState, ErrorState, Panel, Skeleton } from '@/components/organizer/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils/cn';

/**
 * The homepage CMS.
 *
 * ── THE COUNTER IS THE POINT ──────────────────────────────────────────────
 *
 * Every capped field shows how much room is left, and the cap is the SAME
 * number the server enforces (80 for the headline, 180 for the description).
 * They are declared once here and mirrored from the model, so a field can
 * never accept text the API will reject — the failure mode this replaces is
 * typing a paragraph, pressing Save, and being told after the fact.
 *
 * The counter turns amber at 80% rather than only at the limit: a warning that
 * arrives when you are already over is not a warning.
 *
 * ── OPTIMISTIC LOCKING IS SURFACED, NOT SWALLOWED ─────────────────────────
 *
 * The form sends the `version` it loaded. If another operator saved in the
 * meantime the API answers 409, and this says so and offers to reload rather
 * than retrying with a version it knows is stale — a retry loop here would
 * silently overwrite a colleague's edit, which is exactly what the lock
 * exists to prevent.
 *
 * ── SAVE IS EXPLICIT ──────────────────────────────────────────────────────
 *
 * Unlike the event wizard, this does NOT autosave. A draft event is private
 * until published; the homepage is live the moment it is written. Autosaving a
 * half-typed headline onto the front page is not a convenience.
 *
 * ── ONE FILLED BUTTON, AND IT IS "PUBLISH CHANGES" ────────────────────────
 *
 * Publish is the near-black `<Button>`; everything else on the screen — Reload
 * theirs, the per-category controls, Archive — is outline or ghost. Save used
 * to be a violet fill, which put it in the same visual class as any other
 * coloured control and left an operator scanning for the thing that puts text
 * on the front page.
 *
 * The character counter's warning colour is `--warning-subtle-foreground`, not
 * `--warning`: amber on a white page is 2.15:1 and unreadable. A counter you
 * cannot read at the moment it turns is not a counter.
 */

const LIMITS = {
  ribbon_text: 120,
  footer_note: 120,
} as const;

type FieldKey = keyof typeof LIMITS;

export function HomepageCms({
  focus,
  onSaved,
}: {
  /** Which section the Studio's tree has selected. Scrolls it into view. */
  focus?: string;
  /** Fired after a successful save, so the Studio can reload its preview. */
  onSaved?: () => void;
} = {}) {
  const client = useQueryClient();

  // ── THE TREE SWITCHES THE PANE. IT USED TO SCROLL IT. ──────────────────
  //
  // Every section rendered the WHOLE page and then scrolled to an anchor, which
  // failed three ways at once:
  //
  //   - `footer` scrolled to `cms-hero`, an id that does not exist. Picking
  //     "Footer note" moved nothing at all.
  //   - The effect ran before the form had rendered, so `getElementById` was
  //     often null and the scroll silently did nothing.
  //   - Ribbon, Footer and Categories all rendered `FeaturedManager` under
  //     them, so "Featured events" appeared twice in the console and the rail's
  //     seven sections were really one long page with highlights on it.
  //
  // Now each section renders only itself. The fields still belong to ONE record
  // with ONE optimistic-lock version, so they stay inside ONE form with ONE
  // save — splitting them into separate forms is what would make versions race.
  // What changed is what is DRAWN, not what is saved.

  // The UNCACHED admin read — see `fetchHomepageDraft`. Seeding the form from
  // the public, edge-cached payload would hand the optimistic lock a stale
  // version and 409 every save.
  const query = useQuery({
    queryKey: ['admin', 'cms'],
    queryFn: fetchHomepageDraft,
    staleTime: 0,
  });

  const [draft, setDraft] = React.useState<Record<string, string>>({});
  const [ribbonOn, setRibbonOn] = React.useState(false);
  const [stale, setStale] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Seed the form from the server exactly once per load. Re-seeding on every
  // refetch would wipe whatever is being typed.
  const loaded = React.useRef(false);
  React.useEffect(() => {
    if (!query.data || loaded.current) return;
    loaded.current = true;
    setDraft({
      ribbon_text: query.data.ribbon_text,
      footer_note: query.data.footer_note,
    });
    setRibbonOn(query.data.ribbon_enabled);
  }, [query.data]);

  const save = useMutation({
    mutationFn: (version: number) =>
      updateHomepage({
        version,
        // Sent back UNCHANGED from what the server last returned. The
        // endpoint takes the whole record, so omitting these would blank five
        // columns on every ribbon edit — a destructive side effect of removing
        // a form. They are no longer editable here; they are not deleted.
        hero_headline: query.data?.hero_headline ?? '',
        hero_description: query.data?.hero_description ?? '',
        hero_primary_cta: query.data?.hero_primary_cta ?? '',
        hero_secondary_cta: query.data?.hero_secondary_cta ?? '',
        search_placeholder: query.data?.search_placeholder ?? '',
        ribbon_text: draft.ribbon_text ?? '',
        ribbon_enabled: ribbonOn,
        trust_badges: query.data?.trust_badges ?? [],
        footer_note: draft.footer_note ?? '',
      }),
    onSuccess: () => {
      setError(null);
      setStale(false);
      setSaved(true);
      loaded.current = false; // re-seed from the server's new version
      void client.invalidateQueries({ queryKey: ['admin', 'cms'] });
      void client.invalidateQueries({ queryKey: ['admin', 'homepage-draft'] });
      onSaved?.();
      window.setTimeout(() => setSaved(false), 2500);
    },
    onError: (thrown) => {
      if (thrown instanceof ApiError && thrown.code === 'stale_homepage_version') {
        setStale(true);
        setError(null);
        return;
      }
      setError(
        thrown instanceof ApiError ? thrown.message : 'Could not save. Nothing was changed.',
      );
    },
  });

  if (query.isError) {
    return (
      <ErrorState message="Could not load the homepage." onRetry={() => void query.refetch()} />
    );
  }
  if (query.isPending) {
    return (
      <div className="flex flex-col gap-stack">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const set = (key: FieldKey, value: string) =>
    setDraft((current) => ({ ...current, [key]: value.slice(0, LIMITS[key]) }));

  // `focus` is the tree's id; anything unrecognised falls back to the ribbon,
  // which is the first field on this record.
  const section = focus === 'footer' || focus === 'categories' ? focus : 'ribbon';

  return (
    <div
      className={cn(
        'grid gap-block',
        section === 'ribbon' && 'xl:grid-cols-[minmax(0,1fr)_22rem]',
      )}
    >
      <div className="flex flex-col gap-block">
        {stale ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-stack rounded-xl border border-warning-subtle bg-warning-subtle px-card py-2 text-body-sm text-warning-subtle-foreground"
          >
            <span className="min-w-0 flex-1">
              Someone else saved the homepage while you were editing. Reload to see their version —
              your text is still here until you do.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => {
                loaded.current = false;
                setStale(false);
                void query.refetch();
              }}
            >
              Reload theirs
            </Button>
          </div>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-destructive-subtle bg-destructive-subtle px-card py-2 text-body-sm text-destructive-subtle-foreground"
          >
            {error}
          </p>
        ) : null}

        {/* A "Hero" panel stood here: headline, supporting text, two button
            labels, the search placeholder and the trust badges.

            The front page has no hero any more — it opens on the curated
            showcase rail — search moved to the header, and the badges went
            with the copy they sat beneath. Every one of those fields still
            SAVES; none of them is read. So the form is gone rather than left
            in place, because an operator whose edit succeeds and never appears
            learns that this tool does not work.

            What replaced the editorial control: `Featured events`, which
            chooses the actual events on that first screen. */}
        {section === 'ribbon' ? (
        <Panel
          title="Announcement ribbon"
          subtitle="A thin bar above the header"
        >
          <div className="flex flex-col gap-block p-card">
            {/* A native checkbox inside its own label: the whole row is the
                target, which is what makes this reachable at 390px. */}
            <label className="flex min-h-control items-center gap-2.5 text-body-sm text-foreground">
              <input
                type="checkbox"
                checked={ribbonOn}
                onChange={(event) => setRibbonOn(event.target.checked)}
                className="size-5 accent-primary"
              />
              Show the ribbon
            </label>
            <Field
              id="ribbon"
              label="Ribbon text"
              value={draft.ribbon_text ?? ''}
              onChange={(value) => set('ribbon_text', value)}
              max={LIMITS.ribbon_text}
              hint="Turning the ribbon on with no text shows nothing — an empty bar is not a banner."
            />
          </div>
        </Panel>
        ) : null}

        {/* The footer note is NOT part of the announcement ribbon and now has
            its own panel. It lived inside the ribbon's, which is why choosing
            "Footer note" in the tree appeared to open the ribbon editor. */}
        {section === 'footer' ? (
          <Panel title="Footer note" subtitle="One line at the bottom of every page">
            <div className="flex flex-col gap-block p-card">
              <Field
                id="footer-note"
                label="Footer note"
                value={draft.footer_note ?? ''}
                onChange={(value) => set('footer_note', value)}
                max={LIMITS.footer_note}
                hint="Left blank, the footer simply has no note. It is not a required line."
              />
            </div>
          </Panel>
        ) : null}

        {/* The one filled action on this screen. */}
        <div className="flex flex-wrap items-center gap-stack">
          <Button
            type="button"
            onClick={() => save.mutate(query.data.version)}
            disabled={save.isPending}
            loading={save.isPending}
            leftIcon={<Save className="size-4" aria-hidden />}
          >
            Publish changes
          </Button>
          {saved ? (
            <p
              role="status"
              className="inline-flex items-center gap-1.5 text-body-sm text-success-subtle-foreground"
            >
              <Check className="size-4" aria-hidden />
              Live on the homepage
            </p>
          ) : (
            <p className="text-caption text-muted-foreground">
              Changes go live immediately — this page has no draft state.
            </p>
          )}
        </div>

        {/* `FeaturedManager` used to render here TOO, so it appeared under
            every section as well as being section 1 of the tree. */}
        {section === 'categories' ? <Categories /> : null}
      </div>

      {/* The preview is of the RIBBON, so it only accompanies the ribbon. It
          was pinned beside Categories and the footer as well, where it showed
          a bar neither of them edits. */}
      {section === 'ribbon' ? (
        <aside className="xl:sticky xl:top-sticky-top xl:self-start">
          <Preview ribbon={ribbonOn ? (draft.ribbon_text ?? '') : ''} />
        </aside>
      ) : null}
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  max,
  hint,
  multiline,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  max: number;
  hint?: string;
  multiline?: boolean;
}) {
  const near = value.length / max >= 0.8;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-stack">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {/* The same number the server enforces, and it warns BEFORE the limit —
            a warning that arrives once you are over is not a warning. The tint's
            foreground, not `--warning`: amber on white is 2.15:1. */}
        <span
          className={cn(
            'shrink-0 text-caption tabular-nums',
            near ? 'text-warning-subtle-foreground' : 'text-muted-foreground',
          )}
        >
          {value.length}/{max}
        </span>
      </div>
      {multiline ? (
        <Textarea
          id={id}
          value={value}
          rows={3}
          maxLength={max}
          aria-describedby={hintId}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-0 resize-y text-body-sm"
        />
      ) : (
        <Input
          id={id}
          value={value}
          maxLength={max}
          aria-describedby={hintId}
          onChange={(event) => onChange(event.target.value)}
          className="text-body-sm"
        />
      )}
      {hint ? (
        <p id={hintId} className="text-caption text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/*
 * A `TrustBadges` editor lived here — an add/remove list writing
 * `homepage.trust_badges`, the short claims that sat under the old hero
 * headline. The hero is gone and nothing renders them.
 */

/**
 * The live preview, now of the one thing on this screen that still appears on
 * the site: the ribbon.
 *
 * It used to render a mock hero — headline, supporting text and trust badges —
 * which is a preview of a section that no longer exists. A preview whose
 * subject was deleted does not become a smaller preview; it becomes a picture
 * of the past, and an operator would reasonably read it as the front page.
 */
function Preview({ ribbon }: { ribbon: string }) {
  return (
    <Panel title="Ribbon preview" subtitle="Updates as you type">
      <div className="flex flex-col gap-stack p-card">
        {ribbon ? (
          <p className="rounded-full bg-secondary px-3 py-1.5 text-center text-caption text-secondary-foreground">
            {ribbon}
          </p>
        ) : (
          <p className="rounded-full border border-dashed border-border px-3 py-1.5 text-center text-caption text-muted-foreground">
            The ribbon is hidden
          </p>
        )}
        <p className="text-caption text-muted-foreground">
          Shown as a thin bar above the header on every page.
        </p>
      </div>
    </Panel>
  );
}

function Categories() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: fetchAdminCategories,
    staleTime: 0,
  });

  const mutate = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<AdminCategory> }) =>
      updateCategory(id, patch),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['admin'] }),
  });
  const archive = useMutation({
    mutationFn: archiveCategory,
    onSuccess: () => void client.invalidateQueries({ queryKey: ['admin'] }),
  });

  /**
   * Reorder by SWAPPING with a neighbour, not by typing a number.
   *
   * Each row carried a numeric `position` box wired to `onChange`, so ordering
   * eight categories meant knowing that 0 comes first and typing eight numbers
   * — and every keystroke was a save, so typing "12" wrote position 1 and then
   * 12. An operator who wants Comedy above Concerts is not thinking in indices.
   *
   * Both writes are awaited before the list is invalidated, so the row never
   * flashes through a half-applied order.
   */
  const move = useMutation({
    mutationFn: async ({ row, other }: { row: AdminCategory; other: AdminCategory }) => {
      await updateCategory(row.id, { position: other.position });
      await updateCategory(other.id, { position: row.position });
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['admin'] }),
  });

  const rows = query.data?.data ?? [];
  // Order is only meaningful among the categories that are actually in the nav.
  const orderable = rows.filter((row) => !row.archived_at);

  return (
    <Panel
      id="cms-categories"
      title="Categories"
      subtitle="Visibility and order in the browse nav"
      className="scroll-mt-24"
    >
      {query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <div className="flex flex-col gap-2 p-card">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No categories"
          body="The browse nav is empty. Categories normally ship seeded — if this is blank, the seed migration has not run."
        />
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-stack px-card py-2">
              {/* The position number was the first thing on the row and the
                  name came second. An operator scanning for "Comedy" was
                  reading indices. */}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-sm font-medium text-foreground">
                  {row.label}
                </span>
                <span className="block truncate text-caption text-muted-foreground">
                  <span className="font-mono">/{row.slug}</span>
                  {row.search_term && row.search_term !== row.slug ? (
                    <> · searches “{row.search_term}”</>
                  ) : null}
                </span>
              </span>

              {row.archived_at ? (
                <span className="text-caption text-muted-foreground">
                  Archived — its landing page still resolves
                </span>
              ) : (
                <>
                  <label className="inline-flex min-h-control items-center gap-2 text-caption text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={row.is_visible}
                      onChange={(event) =>
                        mutate.mutate({ id: row.id, patch: { is_visible: event.target.checked } })
                      }
                      className="size-5 accent-primary"
                    />
                    Visible
                  </label>
                  {/* ── UP / DOWN, NOT A NUMBER BOX ──────────────────────
                      The same choice the event wizard's gallery makes, for the
                      same reason: nobody reorders by index. Disabled at the
                      ends rather than hidden, so the control does not move
                      under the pointer as a row travels up the list. */}
                  <span className="flex shrink-0 items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={move.isPending || orderable.indexOf(row) <= 0}
                      onClick={() => {
                        const index = orderable.indexOf(row);
                        const other = orderable[index - 1];
                        if (other) move.mutate({ row, other });
                      }}
                      aria-label={`Move ${row.label} up`}
                      className="text-muted-foreground"
                    >
                      <ArrowUp className="size-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={
                        move.isPending ||
                        orderable.indexOf(row) === -1 ||
                        orderable.indexOf(row) >= orderable.length - 1
                      }
                      onClick={() => {
                        const index = orderable.indexOf(row);
                        const other = orderable[index + 1];
                        if (other) move.mutate({ row, other });
                      }}
                      aria-label={`Move ${row.label} down`}
                      className="text-muted-foreground"
                    >
                      <ArrowDown className="size-4" aria-hidden />
                    </Button>
                  </span>

                  {/* Archiving is the one thing here that takes a tile off the
                      browse nav, so it does not sit flush against the routine
                      controls. And it is an ARCHIVE, not a delete — the landing
                      page keeps resolving, so it gets the archive icon. */}
                  <span className="mx-1 hidden h-6 w-px shrink-0 bg-border sm:block" aria-hidden />

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => archive.mutate(row.id)}
                    aria-label={`Archive ${row.label}`}
                    title={`Archive ${row.label}`}
                    className="shrink-0 text-muted-foreground hover:bg-destructive-subtle hover:text-destructive-subtle-foreground"
                  >
                    <Archive className="size-4" aria-hidden />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
