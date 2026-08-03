'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  CloudOff,
  Eye,
  Loader2,
  Pause,
  Play,
  Send,
} from 'lucide-react';
import {
  OCCASION_LABELS,
  PERFORMER_TYPE_LABELS,
  setPerformerPaused,
  submitPerformer,
  updatePerformer,
  type Occasion,
  type OwnerPerformer,
  type PerformerType,
} from '@/lib/api/performers';
import { ApiError } from '@/lib/api/errors';
import { POPULAR_CITIES } from '@/lib/discovery/cities';
import {
  profileState,
  useAct,
  useInvalidatePerformer,
  useReadiness,
} from '@/lib/performer/studio';
import { ErrorState, Skeleton, StatusPill } from '@/components/organizer/primitives';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

/**
 * The profile editor.
 *
 * ── AUTOSAVE ON AN OPTIMISTICALLY-LOCKED RESOURCE ─────────────────────────
 *
 * `PATCH /me/performers/{id}` takes the `version` the client last read and
 * refuses a stale one with `409`. That makes naive autosave dangerous: two
 * saves in flight would send the same version and the second would always
 * fail. So exactly ONE save runs at a time, the version is taken from each
 * response, and edits made during a save queue a single trailing save rather
 * than a racing one. A 409 that still happens means somebody edited on another
 * device — the editor says so and offers to reload rather than retrying with a
 * version it knows is stale, because a retry loop here silently overwrites
 * whatever the other device did.
 *
 * ── WHAT IS EDITABLE IS WHAT THE SERIALIZER ACCEPTS ───────────────────────
 *
 * The brief also asked for a profile photo, a cover image, an FAQ and contact
 * preferences. **None of the four exists.** `PerformerMedia` is one flat
 * gallery with no `kind`, so there is no cover slot to save into; there is no
 * FAQ model and no contact-preference column. They are named at the foot of
 * the page as backend dependencies rather than rendered as inputs that discard
 * what is typed — the failure mode that replaces is a performer who believes
 * they published a cancellation policy and finds out from a customer.
 */

const LIMITS = {
  stage_name: 120,
  tagline: 160,
  bio: 4000,
};

/**
 * Shared control styling for this editor's fields.
 *
 * `border-input` rather than `border-border`: a field's edge is its ONLY
 * affordance, and that is the token tuned to clear the 3:1 non-text contrast
 * requirement on a white surface AND on the dark ladder. Single-line controls
 * are pills at `h-control` (44px); a textarea keeps the card radius, because a
 * fully-rounded multi-line box has nowhere sensible to put its first character.
 */
const CONTROL_BASE =
  'border border-input bg-background text-body-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring';
const CONTROL = `h-control rounded-full px-pill ${CONTROL_BASE}`;
const CONTROL_MULTILINE = `rounded-xl px-3 py-2.5 ${CONTROL_BASE}`;

/** Long enough not to fire per keystroke, short enough to feel automatic. */
const AUTOSAVE_MS = 1200;

type Draft = {
  stage_name: string;
  tagline: string;
  bio: string;
  city: string;
  performer_type: PerformerType;
  travel_radius_km: string;
  base_price_rupees: string;
  experience_years: string;
  typical_set_minutes: string;
  genres: string[];
  languages: string[];
  occasions: Occasion[];
  website_url: string;
  instagram_url: string;
  youtube_url: string;
};

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'stale' | 'error';

function toDraft(act: OwnerPerformer): Draft {
  return {
    stage_name: act.stage_name,
    tagline: act.tagline,
    bio: act.bio,
    city: act.city,
    performer_type: act.performer_type,
    travel_radius_km: String(act.travel_radius_km),
    // Rupees while editing. Somebody types 8000 and means ₹8,000, not ₹80.
    base_price_rupees: act.base_price_minor === null ? '' : String(act.base_price_minor / 100),
    experience_years: String(act.experience_years),
    typical_set_minutes: act.typical_set_minutes === null ? '' : String(act.typical_set_minutes),
    genres: act.genres,
    languages: act.languages,
    occasions: act.occasions,
    website_url: act.website_url,
    instagram_url: act.instagram_url,
    youtube_url: act.youtube_url,
  };
}

function fingerprint(draft: Draft): string {
  return JSON.stringify(draft);
}

export function ProfileEditor({ performerId }: { performerId: string }) {
  const act = useAct(performerId);
  const readiness = useReadiness(performerId);
  const invalidate = useInvalidatePerformer();

  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [state, setState] = React.useState<SaveState>('idle');
  const [error, setError] = React.useState<string | null>(null);

  const version = React.useRef(1);
  const saved = React.useRef('');
  const saving = React.useRef(false);
  const pending = React.useRef(false);
  const timer = React.useRef<number | undefined>(undefined);
  const latest = React.useRef<Draft | null>(null);
  latest.current = draft;

  // Seed once. Re-seeding on every refetch would clobber whatever is being
  // typed at that moment.
  React.useEffect(() => {
    if (!act.data || draft !== null) return;
    const next = toDraft(act.data);
    setDraft(next);
    saved.current = fingerprint(next);
    version.current = act.data.version;
  }, [act.data, draft]);

  React.useEffect(() => () => window.clearTimeout(timer.current), []);

  const flush = React.useCallback(async () => {
    const current = latest.current;
    if (!current) return;
    if (fingerprint(current) === saved.current) {
      setState('saved');
      return;
    }
    // ONE save at a time. Two in flight would send the same version and the
    // second would always 409.
    if (saving.current) {
      pending.current = true;
      return;
    }

    saving.current = true;
    setState('saving');
    setError(null);
    try {
      const response = await updatePerformer(performerId, {
        version: version.current,
        stage_name: current.stage_name.trim(),
        tagline: current.tagline.trim(),
        bio: current.bio,
        city: current.city.trim(),
        performer_type: current.performer_type,
        travel_radius_km: Number(current.travel_radius_km) || 0,
        base_price_minor:
          current.base_price_rupees === ''
            ? null
            : Math.round(Number(current.base_price_rupees) * 100),
        experience_years: Number(current.experience_years) || 0,
        typical_set_minutes:
          current.typical_set_minutes === '' ? null : Number(current.typical_set_minutes),
        genres: current.genres,
        languages: current.languages,
        occasions: current.occasions,
        website_url: current.website_url.trim(),
        instagram_url: current.instagram_url.trim(),
        youtube_url: current.youtube_url.trim(),
      });
      version.current = response.version;
      saved.current = fingerprint(current);
      setState(pending.current ? 'dirty' : 'saved');
      void readiness.refetch();
    } catch (thrown) {
      if (thrown instanceof ApiError && thrown.code === 'stale_performer_version') {
        // Somebody edited elsewhere. Retrying with a version we know is stale
        // would overwrite whatever they did.
        setState('stale');
      } else {
        setState('error');
        setError(
          thrown instanceof ApiError
            ? thrown.message
            : 'Could not save. Your changes are still on screen.',
        );
      }
    } finally {
      saving.current = false;
      if (pending.current) {
        pending.current = false;
        timer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS);
      }
    }
  }, [performerId, readiness]);

  const update = (patch: Partial<Draft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setState('dirty');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS);
  };

  const submit = useMutation({
    mutationFn: () => submitPerformer(performerId),
    onSuccess: () => {
      invalidate();
      setError(null);
    },
    onError: (thrown) =>
      setError(thrown instanceof ApiError ? thrown.message : 'Could not submit.'),
  });

  const pause = useMutation({
    mutationFn: (paused: boolean) => setPerformerPaused(performerId, paused),
    onSuccess: () => invalidate(),
    onError: (thrown) =>
      setError(thrown instanceof ApiError ? thrown.message : 'Could not change that.'),
  });

  if (act.isError) {
    return (
      <ErrorState
        message="Could not load this act."
        onRetry={() => void act.refetch()}
        className="rounded-xl border border-border bg-surface"
      />
    );
  }

  if (act.isPending || !draft) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const status = profileState(act.data);
  const problems = readiness.data?.problems ?? [];
  const canSubmit = act.data.status === 'draft' || act.data.status === 'rejected';

  return (
    <div className="flex flex-col gap-block">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-h2">Profile</h1>
          <p className="mt-1 text-body-sm text-muted-foreground">
            How you appear in the marketplace. Changes save as you type.
          </p>
        </div>
        {/* Preview is an outline: the ONE filled action on this screen is
            "Submit for review" in the banner below, which is the only thing
            here that changes what customers can see. */}
        <div className="flex items-center gap-3">
          <SaveBadge state={state} />
          <Button asChild variant="outline">
            <Link href={`/studio/${performerId}/preview`}>
              <Eye className="size-3.5" aria-hidden />
              Preview
            </Link>
          </Button>
        </div>
      </header>

      <StatusBanner
        status={status}
        act={act.data}
        problems={problems}
        canSubmit={canSubmit}
        submitting={submit.isPending}
        pausing={pause.isPending}
        onSubmit={() => submit.mutate()}
        onPause={(paused) => pause.mutate(paused)}
      />

      {/* A 409 offers a RELOAD, never a retry — retrying a conditional update
          with a refreshed version is how you clobber the edit the optimistic
          lock just protected. */}
      {state === 'stale' ? (
        <p
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-warning-subtle bg-warning-subtle p-card text-body-sm text-warning-subtle-foreground"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          This profile changed somewhere else since you opened it. Reload to get the newer version
          — saving now would overwrite it.
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-body-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-section">
        <Group title="The basics" blurb="What a customer reads first.">
          <Field
            id="stage-name"
            label="Stage name"
            value={draft.stage_name}
            onChange={(stage_name) => update({ stage_name })}
            max={LIMITS.stage_name}
            hint="The name people book you under."
          />
          <Field
            id="tagline"
            label="One line about you"
            value={draft.tagline}
            onChange={(tagline) => update({ tagline })}
            max={LIMITS.tagline}
            hint="Shown on your card in the marketplace. What makes you the right act?"
          />
          <Select
            id="performer-type"
            label="What you are"
            value={draft.performer_type}
            onChange={(value) => update({ performer_type: value as PerformerType })}
            options={(Object.keys(PERFORMER_TYPE_LABELS) as PerformerType[]).map((value) => ({
              value,
              label: PERFORMER_TYPE_LABELS[value],
            }))}
            hint="Briefs are matched on this, so pick the one customers would search for."
          />
          <TextArea
            id="bio"
            label="About the act"
            value={draft.bio}
            onChange={(bio) => update({ bio })}
            max={LIMITS.bio}
            rows={7}
            hint="Who you are, what a set looks like, who you have played for. This is the longest thing anyone reads about you."
          />
        </Group>

        <Group title="Where you play" blurb="Briefs only reach acts in the right city.">
          <div className="flex flex-col gap-1.5">
            <Field
              id="city"
              label="Based in"
              value={draft.city}
              onChange={(city) => update({ city })}
              hint="Match how customers write it — briefs are matched on this exactly."
            />
            <ul className="flex flex-wrap gap-1.5">
              {POPULAR_CITIES.slice(0, 8).map((city) => (
                <li key={city.name}>
                  <Chip
                    active={draft.city === city.name}
                    onClick={() => update({ city: city.name })}
                  >
                    {city.name}
                  </Chip>
                </li>
              ))}
            </ul>
          </div>
          <Field
            id="travel"
            label="How far you travel (km)"
            value={draft.travel_radius_km}
            onChange={(value) => update({ travel_radius_km: value.replace(/[^0-9]/g, '') })}
            hint="Shown on your profile. It does NOT widen which briefs reach you yet — that needs mapped cities."
          />
        </Group>

        <Group title="Price and experience" blurb="What customers use to shortlist.">
          <Field
            id="price"
            label="Starting price (₹)"
            value={draft.base_price_rupees}
            onChange={(value) => update({ base_price_rupees: value.replace(/[^0-9]/g, '') })}
            hint="Leave blank for “price on ask”. A brief whose budget cannot reach this number will not be shown to you."
          />
          <Field
            id="experience"
            label="Years performing"
            value={draft.experience_years}
            onChange={(value) => update({ experience_years: value.replace(/[^0-9]/g, '') })}
          />
          <Field
            id="set-length"
            label="Typical set (minutes)"
            value={draft.typical_set_minutes}
            onChange={(value) => update({ typical_set_minutes: value.replace(/[^0-9]/g, '') })}
            hint="Optional. Left blank, the row is simply omitted from your profile."
          />
        </Group>

        <Group
          title="What you play, and for whom"
          blurb="These drive the marketplace filters — an act with no genres is much harder to find."
        >
          <TagInput
            label="Genres"
            values={draft.genres}
            onChange={(genres) => update({ genres })}
            placeholder="jazz, bollywood, techno…"
          />
          <TagInput
            label="Languages"
            values={draft.languages}
            onChange={(languages) => update({ languages })}
            placeholder="Hindi, English, Tamil…"
          />
          <div className="flex flex-col gap-2">
            <span className="text-body-sm font-medium">Occasions you play</span>
            <ul className="flex flex-wrap gap-1.5">
              {(Object.keys(OCCASION_LABELS) as Occasion[]).map((value) => (
                <li key={value}>
                  <Chip
                    active={draft.occasions.includes(value)}
                    onClick={() =>
                      update({
                        occasions: draft.occasions.includes(value)
                          ? draft.occasions.filter((entry) => entry !== value)
                          : [...draft.occasions, value],
                      })
                    }
                  >
                    {OCCASION_LABELS[value]}
                  </Chip>
                </li>
              ))}
            </ul>
          </div>
        </Group>

        <Group title="Elsewhere" blurb="Optional. Each link is shown only if you fill it in.">
          <Field
            id="website"
            label="Website"
            value={draft.website_url}
            onChange={(website_url) => update({ website_url })}
            placeholder="https://"
          />
          <Field
            id="instagram"
            label="Instagram"
            value={draft.instagram_url}
            onChange={(instagram_url) => update({ instagram_url })}
            placeholder="https://instagram.com/…"
          />
          <Field
            id="youtube"
            label="YouTube"
            value={draft.youtube_url}
            onChange={(youtube_url) => update({ youtube_url })}
            placeholder="https://youtube.com/…"
          />
        </Group>

        {/* Named rather than rendered as inputs that discard what is typed. */}
        <p className="rounded-xl border border-dashed border-border p-card text-caption text-muted-foreground">
          A separate profile photo and cover image, an FAQ, and contact preferences are not
          editable here because there is nowhere to store them: photos are one flat gallery with no
          cover slot, and there is no FAQ or preferences model. They are written up as backend
          dependencies rather than offered as fields that would drop what you typed —{' '}
          <code>frontend/BACKLOG.md</code> items 70 to 72.
        </p>
      </div>
    </div>
  );
}

function StatusBanner({
  status,
  act,
  problems,
  canSubmit,
  submitting,
  pausing,
  onSubmit,
  onPause,
}: {
  status: ReturnType<typeof profileState>;
  act: OwnerPerformer;
  problems: string[];
  canSubmit: boolean;
  submitting: boolean;
  pausing: boolean;
  onSubmit: () => void;
  onPause: (paused: boolean) => void;
}) {
  return (
    <section className="flex flex-col gap-stack rounded-xl border border-border bg-surface p-card shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
        <p className="text-body-sm text-muted-foreground">{status.detail}</p>
      </div>

      {problems.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-body-sm font-medium">
            {canSubmit ? 'Before you can submit' : 'Worth adding'}
          </p>
          <ul className="flex flex-col gap-1.5">
            {problems.map((problem) => (
              <li key={problem} className="flex items-start gap-2 text-body-sm text-muted-foreground">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
                {problem}
              </li>
            ))}
          </ul>
        </div>
      ) : canSubmit ? (
        <p className="flex items-center gap-2 text-body-sm text-success">
          <Check className="size-4" aria-hidden />
          Everything needed is here. Submit when you are ready.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        {canSubmit ? (
          <Button
            disabled={problems.length > 0 || submitting}
            loading={submitting}
            leftIcon={<Send className="size-4" aria-hidden />}
            onClick={onSubmit}
            title={problems.length ? 'Finish the list above first' : undefined}
          >
            {act.status === 'rejected' ? 'Resubmit for review' : 'Submit for review'}
          </Button>
        ) : null}

        {/* Pausing is reversible and routine, so it is an outline rather than a
            destructive fill — and it never appears alongside Submit, since the
            two statuses are disjoint. */}
        {act.status === 'live' || act.status === 'paused' ? (
          <Button
            variant="outline"
            disabled={pausing}
            loading={pausing}
            leftIcon={
              act.status === 'live' ? (
                <Pause className="size-4" aria-hidden />
              ) : (
                <Play className="size-4" aria-hidden />
              )
            }
            onClick={() => onPause(act.status === 'live')}
          >
            {act.status === 'live' ? 'Pause listings' : 'Start taking briefs again'}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The save indicator.
 *
 * A quiet inline badge, never a toast. Autosave fires every couple of seconds;
 * a toast per save would interrupt every time somebody pauses typing, which is
 * the opposite of reassurance.
 */
function SaveBadge({ state }: { state: SaveState }) {
  const content: Record<SaveState, { label: string; tone: string; icon?: React.ReactNode }> = {
    idle: { label: '', tone: '' },
    dirty: { label: 'Unsaved changes', tone: 'text-muted-foreground' },
    saving: {
      label: 'Saving…',
      tone: 'text-muted-foreground',
      icon: <Loader2 className="size-3.5 animate-spin" aria-hidden />,
    },
    saved: {
      label: 'Saved',
      tone: 'text-success',
      icon: <Check className="size-3.5" aria-hidden />,
    },
    stale: {
      label: 'Changed elsewhere',
      tone: 'text-warning',
      icon: <AlertTriangle className="size-3.5" aria-hidden />,
    },
    error: {
      label: 'Could not save',
      tone: 'text-destructive',
      icon: <CloudOff className="size-3.5" aria-hidden />,
    },
  };
  const shown = content[state];
  if (!shown.label) return null;

  return (
    <p
      role="status"
      aria-live="polite"
      className={cn('inline-flex items-center gap-1.5 text-caption', shown.tone)}
    >
      {shown.icon}
      {shown.label}
    </p>
  );
}

/* ---------------------------------------------------------------- fields */

function Group({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-block">
      <header>
        <h2 className="text-h4">{title}</h2>
        <p className="mt-0.5 max-w-prose text-body-sm text-muted-foreground">{blurb}</p>
      </header>
      <div className="flex flex-col gap-block">{children}</div>
    </section>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  max,
  hint,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  max?: number;
  hint?: string;
  placeholder?: string;
}) {
  const near = max ? value.length / max >= 0.8 : false;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-body-sm font-medium">
          {label}
        </label>
        {max ? (
          <span
            className={cn(
              'shrink-0 text-caption tabular-nums',
              near ? 'text-warning' : 'text-muted-foreground',
            )}
          >
            {value.length}/{max}
          </span>
        ) : null}
      </div>
      <input
        id={id}
        value={value}
        maxLength={max}
        placeholder={placeholder}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={CONTROL}
      />
      {/* One reserved line, so a hint appearing never shoves the next field
          down the page while somebody is reading it. */}
      <p id={`${id}-hint`} className="min-h-4 text-caption text-muted-foreground">
        {hint ?? ''}
      </p>
    </div>
  );
}

function TextArea({
  id,
  label,
  value,
  onChange,
  max,
  rows,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  max?: number;
  rows?: number;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-body-sm font-medium">
          {label}
        </label>
        {max ? (
          <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
            {value.length}/{max}
          </span>
        ) : null}
      </div>
      <textarea
        id={id}
        rows={rows ?? 5}
        value={value}
        maxLength={max}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={CONTROL_MULTILINE}
      />
      <p id={`${id}-hint`} className="min-h-4 text-caption text-muted-foreground">
        {hint ?? ''}
      </p>
    </div>
  );
}

function Select({
  id,
  label,
  value,
  onChange,
  options,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-body-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={CONTROL}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="min-h-4 text-caption text-muted-foreground">{hint ?? ''}</p>
    </div>
  );
}

/**
 * A selected value, in the butter "you are here" pill — the same colour the
 * sidebar's active section and an applied lead filter wear, so "chosen" reads
 * identically everywhere in the studio. `h-control-sm` (36px) because these sit
 * in rows of eight or more; the page's real buttons are all 44px.
 */
function Chip({
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
        'motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-nav-active bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
          : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/**
 * A free-tag input.
 *
 * Enter or comma commits; Backspace on an empty field removes the last tag,
 * which is the convention every tag input uses and the thing people try first.
 * Twelve is the server's own cap, so the input stops accepting at the same
 * point the API would refuse.
 */
function TagInput({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const [entry, setEntry] = React.useState('');
  const id = React.useId();
  const full = values.length >= 12;

  const commit = () => {
    const value = entry.trim().replace(/,$/, '');
    if (!value || full) return;
    // Case-insensitive dedupe: "Jazz" and "jazz" are one genre, and both in the
    // list makes the filter chips look broken.
    if (!values.some((existing) => existing.toLowerCase() === value.toLowerCase())) {
      onChange([...values, value]);
    }
    setEntry('');
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-body-sm font-medium">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-input bg-background p-2">
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex h-7 items-center gap-1 rounded-full bg-secondary pl-2.5 pr-1 text-caption text-secondary-foreground"
          >
            {value}
            <button
              type="button"
              onClick={() => onChange(values.filter((entry) => entry !== value))}
              aria-label={`Remove ${value}`}
              className="inline-flex size-5 items-center justify-center rounded-full transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          value={entry}
          disabled={full}
          onChange={(event) => setEntry(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              commit();
            } else if (event.key === 'Backspace' && !entry && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={commit}
          placeholder={values.length ? '' : placeholder}
          className="h-8 min-w-24 flex-1 bg-transparent px-1 text-body-sm outline-none"
        />
      </div>
      <p className="min-h-4 text-caption text-muted-foreground">
        {full ? 'Twelve is the maximum.' : 'Press Enter or comma to add.'}
      </p>
    </div>
  );
}
