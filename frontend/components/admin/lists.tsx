'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  type AdminOrganization,
  type AdminSettlement,
  type AdminUser,
  type PendingVerification,
  decideVerification,
  fetchAdminOrganizations,
  fetchAdminSettlements,
  fetchAdminUsers,
  fetchPendingVerifications,
  releaseSettlement,
} from '@/lib/api/admin';
import { errorMessage } from '@/lib/api/errors';
import { formatEventDate, formatMoney } from '@/lib/discovery/format';
import { cn } from '@/lib/utils/cn';
import { type Column, DataTable, StatusPill } from './data-table';

/**
 * The console's list screens.
 *
 * They share one `DataTable`, so each is a column definition plus whatever
 * actions that record actually supports. Every action here calls a real
 * endpoint and invalidates the queries it affects — there are no optimistic
 * lies: an approval that failed on the server must not linger on screen as
 * approved, because the next operator will act on what they see.
 *
 * ── THESE ARE TABLES, NOT PAGES OF CARDS ──────────────────────────────────
 *
 * The header block is one line of title and one of context, and then the rows
 * start. Nothing decorative sits between an operator and the first row: the
 * job on every one of these screens is to FIND a row, and a hero that pushes
 * row one below the fold costs a scroll on every visit forever.
 *
 * ── MONEY IS RIGHT-ALIGNED AND TABULAR ────────────────────────────────────
 *
 * Every amount column is `text-right tabular-nums`, so digits line up by place
 * value down the column and a ₹1,20,000 payout cannot be misread as ₹12,000 at
 * a glance. Dates get tabular figures for the same reason.
 *
 * ── APPROVE IS FILLED; REJECT IS NOT ──────────────────────────────────────
 *
 * The verification queue is a decision surface, so its two actions are drawn
 * at deliberately different weights with a rule between them — see the long
 * note in `moderation.tsx`. Two same-sized buttons side by side is how an
 * organiser gets rejected by a misclick.
 */

/**
 * 44px on a phone (the touch-target floor), 36px once there is a pointer and a
 * dense table is worth more than the extra 8px.
 */
const TOUCH_DENSE = 'h-control sm:h-control-sm';

const VERIFIED_TONE = { verified: 'ok', pending: 'warn', unverified: 'neutral' } as const;
const SETTLEMENT_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'neutral'> = {
  paid: 'ok',
  pending: 'warn',
  failed: 'bad',
};

function useHighlight() {
  const params = useSearchParams();
  return params?.get('highlight') ?? null;
}

/* ------------------------------------------------------- verifications */

export function VerificationsList() {
  const client = useQueryClient();
  const { toast } = useToast();
  const { data, isPending } = useQuery({
    queryKey: ['admin-verifications'],
    queryFn: fetchPendingVerifications,
  });

  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      decideVerification(id, approve),
    onSuccess: (_result, variables) => {
      toast({
        title: variables.approve ? 'Organizer verified' : 'Verification rejected',
        variant: variables.approve ? 'success' : 'default',
      });
      // The decision changes the queue, the org list AND the overview's
      // pending counter, so all three are invalidated rather than patched.
      void client.invalidateQueries({ queryKey: ['admin-verifications'] });
      void client.invalidateQueries({ queryKey: ['admin-organizations'] });
      void client.invalidateQueries({ queryKey: ['admin-overview'] });
    },
    onError: (error) => toast({ title: errorMessage(error), variant: 'destructive' }),
  });

  const columns: Column<PendingVerification>[] = [
    {
      id: 'organization',
      header: 'Organization',
      searchValue: (row) => row.organization_name,
      sortValue: (row) => row.organization_name.toLowerCase(),
      cell: (row) => <span className="font-medium text-foreground">{row.organization_name}</span>,
    },
    {
      id: 'requested',
      header: 'Requested',
      sortValue: (row) => row.created_at,
      cell: (row) => (
        <span className="tabular-nums text-muted-foreground">{formatEventDate(row.created_at)}</span>
      ),
    },
    {
      id: 'notes',
      header: 'Notes',
      defaultHidden: true,
      cell: (row) => <span className="text-muted-foreground">{row.notes || '—'}</span>,
    },
    {
      id: 'actions',
      header: 'Decision',
      className: 'text-right',
      cell: (row) => (
        <span className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            className={TOUCH_DENSE}
            loading={decide.isPending && decide.variables?.id === row.organization_id}
            leftIcon={<Check className="size-3.5" aria-hidden />}
            onClick={() => decide.mutate({ id: row.organization_id, approve: true })}
          >
            Approve
          </Button>
          {/* A rule and a lighter weight, so the two decisions never read as
              one control with two labels. */}
          <span className="h-6 w-px shrink-0 bg-border" aria-hidden />
          <Button
            size="sm"
            variant="ghost"
            className={cn(
              TOUCH_DENSE,
              'text-muted-foreground hover:bg-destructive-subtle hover:text-destructive-subtle-foreground',
            )}
            leftIcon={<X className="size-3.5" aria-hidden />}
            onClick={() => decide.mutate({ id: row.organization_id, approve: false })}
          >
            Reject
          </Button>
        </span>
      ),
    },
  ];

  return (
    <ListPage
      title="Verifications"
      description="Organizers waiting on a decision. Until one is made they cannot sell."
    >
      <DataTable
        rows={data?.data ?? []}
        columns={columns}
        loading={isPending}
        searchPlaceholder="Search organizations…"
        emptyTitle="Nothing waiting"
        emptyBody="Every verification request has been decided. New ones appear here immediately."
        emptyAction={
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/organizations">Browse organizations</Link>
          </Button>
        }
      />
    </ListPage>
  );
}

/* ------------------------------------------------------- organizations */

export function OrganizationsList() {
  const highlight = useHighlight();
  const { data, isPending } = useQuery({
    queryKey: ['admin-organizations'],
    queryFn: () => fetchAdminOrganizations(),
  });

  const columns: Column<AdminOrganization>[] = [
    {
      id: 'name',
      header: 'Name',
      searchValue: (row) => row.name,
      sortValue: (row) => row.name.toLowerCase(),
      cell: (row) => <span className="font-medium text-foreground">{row.name}</span>,
    },
    {
      id: 'verified',
      header: 'Verification',
      sortValue: (row) => row.verified_level,
      cell: (row) => (
        <StatusPill status={row.verified_level} tone={VERIFIED_TONE[row.verified_level]} />
      ),
    },
    {
      id: 'payouts',
      header: 'Payouts',
      cell: (row) =>
        row.payout_account_id ? (
          <StatusPill status="linked" tone="ok" />
        ) : (
          <StatusPill status="not linked" tone="neutral" />
        ),
    },
    {
      id: 'created',
      header: 'Created',
      sortValue: (row) => row.created_at,
      cell: (row) => (
        <span className="tabular-nums text-muted-foreground">{formatEventDate(row.created_at)}</span>
      ),
    },
    {
      id: 'id',
      header: 'ID',
      defaultHidden: true,
      searchValue: (row) => row.id,
      cell: (row) => (
        <span className="font-mono text-caption text-muted-foreground">{row.id.slice(0, 8)}</span>
      ),
    },
  ];

  return (
    <ListPage title="Organizations" description="Every organization on the platform.">
      <DataTable
        rows={data?.data ?? []}
        columns={columns}
        loading={isPending}
        hasMore={Boolean(data?.meta.next)}
        highlightId={highlight}
        searchPlaceholder="Search by name or id…"
        emptyTitle="No organizations yet"
        emptyBody="Organizations appear here as soon as someone creates one."
      />
    </ListPage>
  );
}

/* ---------------------------------------------------------------- users */

export function UsersList() {
  const highlight = useHighlight();
  const { data, isPending } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => fetchAdminUsers(),
  });

  const columns: Column<AdminUser>[] = [
    {
      id: 'name',
      header: 'Name',
      searchValue: (row) => `${row.full_name} ${row.email}`,
      sortValue: (row) => (row.full_name || row.email).toLowerCase(),
      cell: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-foreground">{row.full_name || '—'}</span>
          <span className="text-caption text-muted-foreground">{row.email}</span>
        </span>
      ),
    },
    {
      id: 'role',
      header: 'Role',
      sortValue: (row) => (row.is_staff ? 'a' : row.is_organizer ? 'b' : 'c'),
      cell: (row) =>
        row.is_staff ? (
          <StatusPill status="operator" tone="ok" />
        ) : row.is_organizer ? (
          <StatusPill status="organizer" tone="warn" />
        ) : (
          <StatusPill status="attendee" tone="neutral" />
        ),
    },
    {
      id: 'joined',
      header: 'Joined',
      sortValue: (row) => row.date_joined,
      cell: (row) => (
        <span className="tabular-nums text-muted-foreground">{formatEventDate(row.date_joined)}</span>
      ),
    },
  ];

  return (
    <ListPage title="Users" description="Attendees, organizers and platform operators.">
      <DataTable
        rows={data?.data ?? []}
        columns={columns}
        loading={isPending}
        hasMore={Boolean(data?.meta.next)}
        highlightId={highlight}
        searchPlaceholder="Search by name or email…"
        emptyTitle="No users yet"
        emptyBody="Accounts appear here as soon as someone registers."
      />
    </ListPage>
  );
}

/* ---------------------------------------------------------- settlements */

export function SettlementsList() {
  const params = useSearchParams();
  const status = params?.get('status') ?? undefined;
  const client = useQueryClient();
  const { toast } = useToast();

  const { data, isPending } = useQuery({
    queryKey: ['admin-settlements', status],
    queryFn: () => fetchAdminSettlements({ status }),
  });

  const release = useMutation({
    mutationFn: (id: string) => releaseSettlement(id),
    onSuccess: () => {
      // 202 Accepted: the payout runs off the request path, so this says
      // "queued", not "paid". Claiming success for money that hasn't moved is
      // the one thing this screen must never do.
      toast({ title: 'Payout release queued', variant: 'success' });
      void client.invalidateQueries({ queryKey: ['admin-settlements'] });
      void client.invalidateQueries({ queryKey: ['admin-overview'] });
    },
    onError: (error) => toast({ title: errorMessage(error), variant: 'destructive' }),
  });

  const columns: Column<AdminSettlement>[] = [
    {
      id: 'event',
      header: 'Event',
      searchValue: (row) => row.event_title,
      sortValue: (row) => row.event_title.toLowerCase(),
      cell: (row) => (
        <Link
          href={`/events/${row.event_id}`}
          className="inline-flex items-center gap-1.5 font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {row.event_title}
          <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (row) => row.status,
      cell: (row) => (
        <StatusPill status={row.status} tone={SETTLEMENT_TONE[row.status] ?? 'neutral'} />
      ),
    },
    {
      id: 'net',
      header: 'Net payout',
      sortValue: (row) => row.net,
      className: 'text-right tabular-nums',
      cell: (row) => <span className="font-medium text-foreground">{formatMoney(row.net)}</span>,
    },
    {
      id: 'gross',
      header: 'Gross',
      defaultHidden: true,
      sortValue: (row) => row.gross,
      className: 'text-right tabular-nums',
      cell: (row) => <span className="text-muted-foreground">{formatMoney(row.gross)}</span>,
    },
    {
      id: 'refunds',
      header: 'Refunds',
      defaultHidden: true,
      sortValue: (row) => row.refunds,
      className: 'text-right tabular-nums',
      cell: (row) => <span className="text-muted-foreground">{formatMoney(row.refunds)}</span>,
    },
    {
      id: 'attempts',
      header: 'Attempts',
      sortValue: (row) => row.attempts,
      className: 'text-right tabular-nums',
      cell: (row) => (
        <span
          className={row.error ? 'text-destructive-subtle-foreground' : 'text-muted-foreground'}
          title={row.error || undefined}
        >
          {row.attempts}
          {row.error ? ' · failed' : ''}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      className: 'text-right',
      cell: (row) =>
        row.status === 'paid' ? null : (
          <Button
            size="sm"
            variant="outline"
            className={TOUCH_DENSE}
            loading={release.isPending && release.variables === row.id}
            onClick={() => release.mutate(row.id)}
          >
            Release
          </Button>
        ),
    },
  ];

  return (
    <ListPage
      title="Settlements"
      description="Organizer payouts. Release re-drives a dead-lettered payout; it never pays twice."
    >
      <DataTable
        rows={data?.data ?? []}
        columns={columns}
        loading={isPending}
        hasMore={Boolean(data?.meta.next)}
        searchPlaceholder="Search by event…"
        emptyTitle={status === 'failed' ? 'No failed payouts' : 'No settlements yet'}
        emptyBody={
          status === 'failed'
            ? 'Every payout has either succeeded or is still waiting for its event to finish.'
            : 'A settlement is created for an event once it has taken money.'
        }
        emptyAction={
          status ? (
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/settlements">Show all settlements</Link>
            </Button>
          ) : undefined
        }
      />
    </ListPage>
  );
}

/* ------------------------------------------------------------- shared */

function ListPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-block">
      <header className="flex flex-col gap-1">
        <h1 className="text-h3">{title}</h1>
        <p className="text-body-sm text-muted-foreground">{description}</p>
      </header>
      {children}
    </div>
  );
}

/** The console's icon for an empty verification queue, exported for reuse. */
export const VerificationsIcon = ShieldCheck;
