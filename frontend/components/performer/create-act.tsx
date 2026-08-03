'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api/client';
import type { Paginated } from '@/lib/api/types';
import {
  PERFORMER_TYPE_LABELS,
  createPerformer,
  type PerformerType,
} from '@/lib/api/performers';
import { ApiError } from '@/lib/api/errors';
import { useInvalidatePerformer } from '@/lib/performer/studio';
import { Skeleton } from '@/components/organizer/primitives';
import { Button } from '@/components/ui/button';

/** The two fields this form needs. `/organizations/` returns much more. */
type Organization = { id: string; name: string };

/**
 * Shared control styling for this form's inputs and selects.
 *
 * `border-input` rather than `border-border`: a field's edge is its ONLY
 * affordance, and that token is the one stop that clears the 3:1 non-text
 * requirement against both a white and a dark surface. Pill-shaped and
 * `h-control` (44px) so a field, a chip and a button all line up.
 */
const CONTROL =
  'h-control rounded-full border border-input bg-background px-pill text-body-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Creating an act.
 *
 * ── FOUR FIELDS, THEN THE STUDIO ──────────────────────────────────────────
 *
 * `POST /me/performers` requires organisation, stage name, type and city.
 * Everything else — bio, genres, prices, photos — is optional on the model and
 * is edited far better in the profile editor, next to a live preview and with
 * autosave. Asking for twenty fields before anything exists is how a listing
 * gets abandoned at field nine with nothing saved.
 *
 * The act is created as a DRAFT. Nothing is public until the owner submits it
 * and a human approves it, which the next screen says plainly.
 */
export function CreateAct() {
  const router = useRouter();
  const invalidate = useInvalidatePerformer();

  const organizations = useQuery({
    queryKey: ['organizer', 'organizations'],
    queryFn: () => api.get<Paginated<Organization>>('/organizations/'),
    staleTime: 300_000,
  });
  const orgs = React.useMemo(() => organizations.data?.data ?? [], [organizations.data]);

  const [organizationId, setOrganizationId] = React.useState('');
  const [stageName, setStageName] = React.useState('');
  const [performerType, setPerformerType] = React.useState<PerformerType>('band');
  const [city, setCity] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  // Only defaults the field; it never overwrites a choice already made.
  React.useEffect(() => {
    if (!organizationId && orgs[0]) setOrganizationId(orgs[0].id);
  }, [orgs, organizationId]);

  const create = useMutation({
    mutationFn: createPerformer,
    onSuccess: (act) => {
      invalidate();
      router.push(`/studio/${act.id}/profile`);
    },
    onError: (thrown) =>
      setError(
        thrown instanceof ApiError ? thrown.message : 'Could not create the listing. Try again.',
      ),
  });

  if (organizations.isPending) {
    return <Skeleton className="h-80 w-full rounded-xl" />;
  }

  if (orgs.length === 0) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-stack-lg py-section text-center">
        <h1 className="text-h3">You need an organisation first</h1>
        <p className="text-body-sm text-muted-foreground">
          An act belongs to an organisation — the same entity that gets verified and paid. It is
          how a customer knows who they are dealing with.
        </p>
        <Button asChild variant="outline">
          <Link href="/dashboard">Back to the dashboard</Link>
        </Button>
      </div>
    );
  }

  const ready = stageName.trim().length >= 2 && city.trim().length >= 2 && organizationId;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-block py-block">
      <Button asChild variant="ghost" size="sm" className="w-fit -ml-2">
        <Link href="/studio">
          <ArrowLeft className="size-3.5" aria-hidden />
          Studio
        </Link>
      </Button>

      <header className="flex flex-col gap-1">
        <h1 className="text-h2">List your act</h1>
        <p className="text-body-sm text-muted-foreground">
          Four things to start. You will fill in the rest with a live preview beside you, and
          nothing is public until you submit it and we have looked at it.
        </p>
      </header>

      <form
        className="flex flex-col gap-stack-lg"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          create.mutate({
            organization_id: organizationId,
            stage_name: stageName.trim(),
            performer_type: performerType,
            city: city.trim(),
          });
        }}
      >
        {orgs.length > 1 ? (
          <Field label="Organisation" htmlFor="act-org">
            <select
              id="act-org"
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
              className={CONTROL}
            >
              {orgs.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field
          label="Stage name"
          htmlFor="act-name"
          hint="What people should book you as, not your legal name."
        >
          <input
            id="act-name"
            value={stageName}
            onChange={(event) => setStageName(event.target.value)}
            maxLength={120}
            autoComplete="off"
            className={CONTROL}
          />
        </Field>

        <Field label="What are you" htmlFor="act-type">
          <select
            id="act-type"
            value={performerType}
            onChange={(event) => setPerformerType(event.target.value as PerformerType)}
            className={CONTROL}
          >
            {(Object.keys(PERFORMER_TYPE_LABELS) as PerformerType[]).map((type) => (
              <option key={type} value={type}>
                {PERFORMER_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Based in"
          htmlFor="act-city"
          hint="The city you work out of. You can say how far you travel later."
        >
          <input
            id="act-city"
            value={city}
            onChange={(event) => setCity(event.target.value)}
            maxLength={80}
            autoComplete="address-level2"
            className={CONTROL}
          />
        </Field>

        {error ? (
          <p role="alert" className="text-body-sm text-destructive">
            {error}
          </p>
        ) : null}

        {/* `disabled` is passed explicitly as well as `loading`: Button reads
            `disabled ?? loading`, so an explicit `false` would keep a busy
            button clickable and let a double-submit through. */}
        <Button
          type="submit"
          disabled={!ready || create.isPending}
          loading={create.isPending}
        >
          Create the listing
        </Button>
      </form>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-body-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
