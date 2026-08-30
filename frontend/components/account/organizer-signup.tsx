'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  Clock,
  Loader2,
  ShieldAlert,
  Upload,
  Wallet,
} from 'lucide-react';
import {
  createOrganization,
  fetchVerification,
  linkPayoutAccount,
  submitVerification,
} from '@/lib/api/organizations';
// The LIST shape, from the scope hook that already fetches it — not the
// detail shape. Two components fetching the same list under two keys is how
// the header and this page end up disagreeing about what exists.
import { useOrganizations, type Organization } from '@/lib/identity/scope';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/organizer/primitives';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils/cn';

/**
 * Becoming an organizer.
 *
 * ── IT IS NOT AN ACCOUNT TYPE, SO IT IS NOT A CHOICE AT SIGN-UP ───────────
 *
 * The backend has no organizer role: an `Organization` is a row OWNED BY a
 * user, and one person may own several. A radio button at registration would
 * be UI for a distinction the data model does not make — and it would ask
 * people to declare an intention before they have seen the product. So this
 * is an action on an account that already exists.
 *
 * ── THE TWO STEPS ARE SEPARATE BECAUSE ONE IS INSTANT AND ONE IS NOT ──────
 *
 * Creating the organization is immediate. APPROVAL is a human decision by an
 * operator, and until it lands the account is not an organizer: the dashboard
 * shows `AwaitingApproval`, the door below is not rendered, and the backend
 * refuses `POST /events/{id}/publish` with `organization_not_verified` — a
 * gate that only renders is not a gate. Drafts can still be built while
 * waiting, because the thing under review is who is selling, not what they
 * are selling.
 *
 * The two are not collapsed into one form because one of them takes days.
 * Every state below is drawn separately so the card never implies a review
 * that has not happened.
 *
 * ── EVERY STATE IS DRAWN, INCLUDING THE ONE NOBODY LIKES ──────────────────
 *
 * Unverified, pending, rejected and approved each get a distinct panel.
 * REJECTED shows the operator's reason verbatim and offers a resubmit — a
 * refusal with no reason is one an organizer cannot act on, and it is the
 * state most likely to be quietly dropped from a build like this.
 *
 * ── ONE FILLED BUTTON PER STATE ───────────────────────────────────────────
 *
 * Each card offers exactly one submit — "Create organization", or "Submit for
 * review" — and that is the only control wearing the primary shape. Everything
 * else (a second organization, the dashboard door, the file picker) is the
 * quiet outline pill. The verification form itself sits in a `bg-sunken` well
 * INSIDE the card, so the thing being asked for is visibly nested in the thing
 * it belongs to rather than floating as a second card.
 */
export function OrganizerSignup() {
  const organizations = useOrganizations();
  const mine = organizations.data?.data ?? [];

  if (organizations.isPending) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className="flex flex-col gap-block lg:gap-block-lg">
      <header className="flex flex-col gap-stack">
        <h1 className="text-h3 md:text-h2">Host events</h1>
        <p className="max-w-prose text-body text-muted-foreground">
          Create an organization to publish events and sell tickets. You keep your existing
          account, and can own more than one.
        </p>
      </header>

      {mine.length === 0 ? <CreateForm /> : <OrganizationList organizations={mine} />}
    </div>
  );
}

/* ── Create ──────────────────────────────────────────────────────────── */

function CreateForm() {
  const client = useQueryClient();
  const [name, setName] = React.useState('');
  const [logo, setLogo] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createOrganization({ name: name.trim(), logo }),
    onSuccess: () => {
      setError(null);
      // The scope switcher reads this same list, so the new organization
      // appears in the header without a reload.
      void client.invalidateQueries({ queryKey: ['identity', 'organizations'] });
    },
    onError: (thrown) => setError(errorMessage(thrown)),
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
      className="flex max-w-xl flex-col gap-block rounded-xl border border-border bg-surface p-card shadow-sm lg:p-card-lg"
    >
      <div className="flex items-center gap-3">
        {/* Neutral tile, not a violet-tinted one: violet is reserved for
            wayfinding now, and a decorative icon plate is not wayfinding. It
            is also the same tile the account menu gives an organisation. */}
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          <Building2 className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-h4">Create an organization</h2>
          <p className="text-caption text-foreground-subtle">This takes a minute.</p>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-destructive-subtle px-card py-3 text-body-sm text-destructive-subtle-foreground"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-stack">
        <Label htmlFor="org-name">Organization name</Label>
        <Input
          id="org-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Acme Live"
          maxLength={200}
          required
        />
        <p className="text-caption text-muted-foreground">
          This is the name ticket buyers see on your events. You can change it later.
        </p>
      </div>

      <div className="flex flex-col gap-stack">
        <Label htmlFor="org-logo">Logo (optional)</Label>
        <div className="flex items-center gap-3">
          <label
            htmlFor="org-logo"
            className="inline-flex h-control shrink-0 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-pill text-label transition-colors hover:bg-muted focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background"
          >
            <Upload className="size-4" aria-hidden />
            Choose file
          </label>
          <input
            id="org-logo"
            type="file"
            // The server checks the declared type against an allow-list AND
            // the leading bytes against that type. This attribute is a
            // convenience for the file picker, never the check.
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(event) => setLogo(event.target.files?.[0] ?? null)}
          />
          <span className="min-w-0 truncate text-body-sm text-muted-foreground">
            {logo ? logo.name : 'No file chosen'}
          </span>
        </div>
      </div>

      <div>
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          {create.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {create.isPending ? 'Creating…' : 'Create organization'}
        </Button>
      </div>
    </form>
  );
}

/* ── List + status ───────────────────────────────────────────────────── */

function OrganizationList({ organizations }: { organizations: Organization[] }) {
  const [adding, setAdding] = React.useState(false);

  return (
    <div className="flex flex-col gap-block">
      <ul className="flex flex-col gap-block">
        {organizations.map((organization) => (
          <li key={organization.id}>
            <OrganizationCard organization={organization} />
          </li>
        ))}
      </ul>

      {adding ? (
        <CreateForm />
      ) : (
        <div>
          <Button variant="outline" onClick={() => setAdding(true)}>
            Create another organization
          </Button>
        </div>
      )}
    </div>
  );
}

function OrganizationCard({ organization }: { organization: Organization }) {
  const client = useQueryClient();
  const [notes, setNotes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const verification = useQuery({
    queryKey: ['organization-verification', organization.id],
    queryFn: () => fetchVerification(organization.id),
    staleTime: 15_000,
  });

  const submit = useMutation({
    mutationFn: () => submitVerification(organization.id, notes.trim()),
    onSuccess: () => {
      setError(null);
      setNotes('');
      void client.invalidateQueries({ queryKey: ['organization-verification', organization.id] });
      void client.invalidateQueries({ queryKey: ['identity', 'organizations'] });
    },
    onError: (thrown) => setError(errorMessage(thrown)),
  });

  const record = verification.data;
  // `verified_level` is the ORGANIZATION's state; the record carries the
  // reason. They can disagree briefly — an operator's decision lands on the
  // record first — so the record wins wherever it is present.
  const state: 'verified' | 'pending' | 'rejected' | 'none' =
    organization.verified_level === 'verified'
      ? 'verified'
      : record?.status === 'rejected'
        ? 'rejected'
        : record?.status === 'pending' || organization.verified_level === 'pending'
          ? 'pending'
          : 'none';

  return (
    <div className="flex flex-col gap-block rounded-xl border border-border bg-surface p-card shadow-sm lg:p-card-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-h4">{organization.name}</h2>
          <p className="text-caption text-foreground-subtle">
            Created {new Date(organization.created_at).toLocaleDateString()}
          </p>
        </div>
        <StatusPill state={state} />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-destructive-subtle px-card py-3 text-body-sm text-destructive-subtle-foreground"
        >
          {error}
        </p>
      ) : null}

      {verification.isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : state === 'verified' ? (
        <p className="text-body-sm text-muted-foreground">
          Verified. You can publish events and receive payouts.
        </p>
      ) : state === 'pending' ? (
        <p className="text-body-sm text-muted-foreground">
          Submitted for review. You can keep building draft events while you wait;
          publishing and payouts unlock on approval.
        </p>
      ) : (
        <VerificationForm
          heading={state === 'rejected' ? 'Submit again' : 'Get verified'}
          // The reason, verbatim. A refusal without one is a refusal the
          // organizer cannot act on.
          rejection={state === 'rejected' ? record?.notes : undefined}
          notes={notes}
          onNotes={setNotes}
          onSubmit={() => submit.mutate()}
          pending={submit.isPending}
        />
      )}

      {/* THE DASHBOARD DOOR APPEARS ONLY ONCE AN OPERATOR HAS APPROVED.

          It used to render unconditionally, on every card, in every state —
          so a brand-new organization that had not even been submitted for
          review offered "Open organizer dashboard", and the dashboard then
          met it with an awaiting-approval wall. The guard was never the
          problem; the invitation was. A control that is certain to be refused
          is worse than no control: the reader concludes the product is broken
          rather than that they are waiting on a decision.

          `state` is the same value the pill above shows, so the card cannot
          say "Pending" and offer the approved-only door in the same breath. */}
      {state === 'verified' ? (
        <div className="flex flex-wrap gap-2 border-t border-border pt-block">
          <Link
            href="/dashboard"
            className="inline-flex h-control items-center gap-1.5 rounded-full border border-border bg-surface px-pill text-label transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Open organizer dashboard
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          <PayoutAccountButton organization={organization} />
        </div>
      ) : null}
    </div>
  );
}

function VerificationForm({
  heading,
  rejection,
  notes,
  onNotes,
  onSubmit,
  pending,
}: {
  heading: string;
  rejection?: string;
  notes: string;
  onNotes: (value: string) => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  return (
    <div className="flex flex-col gap-block rounded-xl border border-border bg-sunken p-card">
      {rejection ? (
        <div className="flex gap-3 rounded-lg bg-destructive-subtle p-card">
          <ShieldAlert
            className="mt-0.5 size-4 shrink-0 text-destructive-subtle-foreground"
            aria-hidden
          />
          <div className="flex flex-col gap-1">
            <p className="text-label text-destructive-subtle-foreground">
              Your last application was not approved
            </p>
            <p className="text-body-sm text-destructive-subtle-foreground">{rejection}</p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-stack">
        <h3 className="text-h4">{heading}</h3>
        <p className="text-body-sm text-muted-foreground">
          Verification unlocks publishing and payouts. Tell us the registered entity and
          what you run.
        </p>
      </div>

      <div className="flex flex-col gap-stack">
        <Label htmlFor={`notes-${heading}`}>Notes for the reviewer</Label>
        <Textarea
          id={`notes-${heading}`}
          value={notes}
          onChange={(event) => onNotes(event.target.value)}
          rows={4}
          maxLength={500}
          placeholder="Registered as Acme Live Pvt Ltd, GSTIN 27ABCDE1234F1Z5. We run comedy nights in Mumbai."
        />
        <p className="text-caption tabular-nums text-foreground-subtle">{notes.length}/500</p>
      </div>

      <div>
        <Button onClick={onSubmit} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {pending ? 'Submitting…' : 'Submit for review'}
        </Button>
      </div>
    </div>
  );
}

function StatusPill({ state }: { state: 'verified' | 'pending' | 'rejected' | 'none' }) {
  const map = {
    verified: { label: 'Verified', icon: BadgeCheck, className: 'bg-success-subtle text-success-subtle-foreground' },
    pending: { label: 'In review', icon: Clock, className: 'bg-warning-subtle text-warning-subtle-foreground' },
    rejected: { label: 'Not approved', icon: ShieldAlert, className: 'bg-destructive-subtle text-destructive-subtle-foreground' },
    none: { label: 'Unverified', icon: ShieldAlert, className: 'bg-muted text-muted-foreground' },
  } as const;
  const { label, icon: Icon, className } = map[state];

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-caption font-medium',
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}

/**
 * Link the account money is paid into, or refresh it.
 *
 * ── WHY IT IS HERE AND NOT ONLY IN THE DASHBOARD ──────────────────────────
 *
 * This card is where somebody sets an organization up, and being paid is part
 * of setting one up. An organizer who never finds this sells tickets into a
 * settlement that has nowhere to release to — which surfaces weeks later as a
 * payout that will not go, long after the event.
 *
 * ── "UPDATE" IS HONEST, AND THAT WAS WORTH CHECKING ───────────────────────
 *
 * There is no edit endpoint. `POST .../payout-account` calls the provider with
 * `reference_id = organization.id`, so re-running it resolves to the SAME
 * linked account and refreshes it against the organization's current name and
 * the owner's current email. That makes a second press safe and makes
 * "Update" a true description rather than a label over a create.
 *
 * If it were not idempotent this would be a link-once control that disappears,
 * because a button that silently creates a second payout account is how money
 * goes to the wrong place.
 */
function PayoutAccountButton({ organization }: { organization: Organization }) {
  const client = useQueryClient();
  const toast = useToast();
  const linked = Boolean(organization.payout_account_id);

  const mutation = useMutation({
    mutationFn: () => linkPayoutAccount(organization.id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['account', 'organizations'] });
      void client.invalidateQueries({ queryKey: ['identity', 'organizations'] });
      toast.toast({
        title: linked ? 'Payout account updated' : 'Payout account added',
        description: 'Settlements for your events release to this account.',
        variant: 'success',
      });
    },
    onError: (error: unknown) =>
      toast.toast({
        title: 'Could not save that',
        description:
          error instanceof ApiError ? error.message : 'Please try again in a moment.',
        variant: 'destructive',
      }),
  });

  return (
    <button
      type="button"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      className="inline-flex h-control items-center gap-1.5 rounded-full border border-border bg-surface px-pill text-label transition-colors hover:bg-muted disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {mutation.isPending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Wallet className="size-4" aria-hidden />
      )}
      {linked ? 'Edit payout account' : 'Add payout account'}
    </button>
  );
}
