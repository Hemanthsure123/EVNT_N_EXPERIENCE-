'use client';

import * as React from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, RotateCcw, ShieldCheck, Users } from 'lucide-react';
import { fetchAdminUsers, setUserSuspended, type AdminUser, type UserRole } from '@/lib/api/admin';
import { cursorFromNextLink } from '@/lib/api/events';
import { ApiError } from '@/lib/api/errors';
import { useAuth } from '@/lib/auth/auth-provider';
import { Button } from '@/components/ui/button';
import { useDataTable, type ColumnDef } from '@/lib/organizer/table';
import { useDebouncedValue } from '@/lib/utils/use-debounced-value';
import { EmptyState, ErrorState, StatusPill } from '@/components/organizer/primitives';
import {
  ColumnChooser,
  DataGrid,
  DensityToggle,
  ExportButton,
  TableSkeleton,
  TableToolbar,
} from '@/components/organizer/data-table';
import { SearchField } from '@/components/organizer/filters';
import { cn } from '@/lib/utils/cn';
import { useUndo } from './undo';

/**
 * User management.
 *
 * ── SUSPENSION IS AN ACCESS DECISION, NOT A LABEL ─────────────────────────
 *
 * It sets `is_active = false`, and `AuthService.authenticate` refuses an
 * inactive account outright — so a suspended user cannot sign in, full stop.
 * That is worth knowing before pressing it, so the button says "Suspend" and
 * the row afterwards says "Suspended", not "Inactive".
 *
 * ── UNDO INSTEAD OF "ARE YOU SURE?" ───────────────────────────────────────
 *
 * Suspension is fully reversible, so it gets the undo toast rather than a
 * dialog. The write goes IMMEDIATELY and Undo issues the compensating
 * reinstate — it is not a five-second delay pretending to be an action. A
 * confirmation dialog would tax every suspension to prevent the rare misclick,
 * and people learn to dismiss those without reading.
 *
 * ── TWO REFUSALS COME FROM THE SERVER, AND ARE MIRRORED HERE ──────────────
 *
 * An operator cannot suspend themselves (they would be locked out on the next
 * request) and cannot suspend another staff member (operators could suspend
 * each other until nobody can sign in). The server enforces both with a `409`;
 * the button is disabled with a tooltip so nobody meets that by accident, but
 * the server check remains the real one.
 *
 * ── THE ACTION IS QUIET, BECAUSE IT IS NOT WHAT THIS SCREEN IS FOR ────────
 *
 * Suspend is a GHOST button that only picks up the destructive tint on hover,
 * and Reinstate is an outline. Neither is the filled pill: this screen is a
 * directory an operator searches, not a decision queue, and a column of solid
 * buttons down the right-hand edge would pull the eye away from the names
 * being scanned. The queues (`moderation.tsx`) are where the filled action
 * lives.
 *
 * ── WHAT IS NOT HERE ──────────────────────────────────────────────────────
 *
 * Warnings, per-user activity, and a user's orders/tickets/refunds. There is
 * no warning model, no per-user audit view, and no admin endpoint that lists
 * one person's bookings — the audit log is filterable by `target_id`, which
 * covers what was DONE TO an account but not what the account did. BACKLOG
 * items 54 and 56.
 */

const ROLE_TABS: { value: UserRole; label: string }[] = [
  { value: '', label: 'Everyone' },
  { value: 'organizer', label: 'Organizers' },
  { value: 'staff', label: 'Operators' },
  { value: 'attendee', label: 'Attendees' },
  { value: 'suspended', label: 'Suspended' },
];

/**
 * The role filter pill.
 *
 * The applied one is the BUTTER pill (`--nav-active`) — the same "you are
 * here" token as the sidebar's active section and every other applied filter
 * in the console. Not the brand violet: a filter that is filled with the
 * accent reads as a button rather than as a state.
 *
 * 44px on a phone, 36px from `sm` up where a pointer does not need the floor
 * and a dense list does.
 */
const tabClass = (active: boolean) =>
  cn(
    'inline-flex h-control items-center rounded-full border px-pill text-label sm:h-control-sm',
    'transition-colors duration-fast motion-reduce:transition-none',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    active
      ? 'border-transparent bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
  );

export function UsersConsole() {
  const client = useQueryClient();
  const { user: me } = useAuth();
  const { offer } = useUndo();

  const [term, setTerm] = React.useState('');
  const [role, setRole] = React.useState<UserRole>('');
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const search = useDebouncedValue(term.trim(), 250);

  const query = useInfiniteQuery({
    queryKey: ['admin', 'users', { search, role }],
    queryFn: ({ pageParam }) =>
      fetchAdminUsers({
        q: search || undefined,
        role: role || undefined,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => cursorFromNextLink(last.meta.next),
    staleTime: 0,
  });

  const rows = React.useMemo(
    () => query.data?.pages.flatMap((page) => page.data) ?? [],
    [query.data],
  );

  const setSuspended = React.useCallback(
    async (row: AdminUser, suspended: boolean) => {
      setBusyId(row.id);
      setError(null);
      try {
        await setUserSuspended(row.id, suspended);
        void client.invalidateQueries({ queryKey: ['admin', 'users'] });
        offer({
          message: `${suspended ? 'Suspended' : 'Reinstated'} ${row.email}`,
          // The COMPENSATING write, not a deferred one — the suspension has
          // already happened by the time this toast appears.
          undo: async () => {
            await setUserSuspended(row.id, !suspended);
            void client.invalidateQueries({ queryKey: ['admin', 'users'] });
          },
        });
      } catch (thrown) {
        setError(
          thrown instanceof ApiError ? thrown.message : 'That change did not go through.',
        );
      } finally {
        setBusyId(null);
      }
    },
    [client, offer],
  );

  const columns = React.useMemo(
    () => buildColumns({ meId: me?.id ?? '', busyId, onToggle: setSuspended }),
    [me?.id, busyId, setSuspended],
  );

  const table = useDataTable<AdminUser>({
    id: 'admin-users',
    columns,
    rows,
    rowId: (row) => row.id,
  });

  return (
    <div className="flex flex-col gap-stack-lg">
      <div role="tablist" aria-label="Role" className="flex flex-wrap gap-1.5">
        {ROLE_TABS.map((tab) => (
          <button
            key={tab.value || 'all'}
            role="tab"
            type="button"
            aria-selected={role === tab.value}
            onClick={() => setRole(tab.value)}
            className={tabClass(role === tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-destructive-subtle px-3 py-2 text-body-sm text-destructive-subtle-foreground"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <TableToolbar>
          <SearchField
            value={term}
            onChange={setTerm}
            placeholder="Name or email"
            label="Search accounts"
          />
          <div className="ml-auto flex items-center gap-2">
            <DensityToggle table={table} />
            <ColumnChooser table={table} />
            <ExportButton table={table} filename="users.csv" disabled={query.isPending} />
          </div>
        </TableToolbar>

        {query.isError ? (
          <ErrorState message="Could not load accounts." onRetry={() => void query.refetch()} />
        ) : query.isPending ? (
          <TableSkeleton rows={8} columns={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={term || role ? 'Nobody matches' : 'No accounts yet'}
            body={
              role === 'suspended'
                ? 'No account is currently suspended.'
                : 'Accounts appear here as soon as somebody registers — they cannot be created by hand.'
            }
          />
        ) : (
          <DataGrid
            table={table}
            caption="Every account on the platform"
            selectable={false}
            loading={query.isFetchingNextPage}
          />
        )}

        {query.hasNextPage ? (
          <div className="flex flex-col items-center gap-1.5 border-t border-border py-4">
            <Button
              variant="outline"
              onClick={() => void query.fetchNextPage()}
              loading={query.isFetchingNextPage}
            >
              Load more
            </Button>
            {table.sort.length ? (
              <p className="text-caption text-muted-foreground">
                Sorted within the {rows.length} accounts loaded so far, not across every account.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function buildColumns({
  meId,
  busyId,
  onToggle,
}: {
  meId: string;
  busyId: string | null;
  onToggle: (row: AdminUser, suspended: boolean) => void;
}): ColumnDef<AdminUser>[] {
  return [
    {
      key: 'name',
      header: 'Account',
      width: 260,
      minWidth: 160,
      hideable: false,
      sortValue: (row) => (row.full_name || row.email).toLowerCase(),
      render: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{row.full_name || row.email}</span>
          {row.full_name ? (
            <span className="truncate text-caption text-muted-foreground">{row.email}</span>
          ) : null}
        </span>
      ),
      exportValue: (row) => row.email,
    },
    {
      key: 'role',
      header: 'Role',
      width: 130,
      // Operators first, then organizers, then attendees — the order an
      // operator scanning for privilege would want.
      sortValue: (row) => (row.is_staff ? 'a' : row.is_organizer ? 'b' : 'c'),
      render: (row) =>
        row.is_staff ? (
          <StatusPill tone="info">Operator</StatusPill>
        ) : row.is_organizer ? (
          <StatusPill tone="warning">Organizer</StatusPill>
        ) : (
          <StatusPill tone="neutral">Attendee</StatusPill>
        ),
      exportValue: (row) => (row.is_staff ? 'operator' : row.is_organizer ? 'organizer' : 'attendee'),
    },
    {
      key: 'access',
      header: 'Access',
      width: 120,
      sortValue: (row) => (row.is_active ? 1 : 0),
      render: (row) =>
        row.is_active ? (
          <StatusPill tone="success">Active</StatusPill>
        ) : (
          <StatusPill tone="danger">Suspended</StatusPill>
        ),
      exportValue: (row) => (row.is_active ? 'active' : 'suspended'),
    },
    {
      key: 'date_joined',
      header: 'Joined',
      width: 130,
      sortValue: (row) => Date.parse(row.date_joined),
      render: (row) => (
        <time dateTime={row.date_joined} className="tabular-nums text-muted-foreground">
          {new Date(row.date_joined).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </time>
      ),
      exportValue: (row) => row.date_joined,
    },
    {
      key: 'actions',
      header: '',
      // Wide enough for the longer of the two labels at pill padding — the
      // grid's cells are `truncate`, so a button that overruns is clipped
      // rather than wrapped.
      width: 170,
      hideable: false,
      render: (row) => {
        const self = row.id === meId;
        // Mirrors the server's own refusals, so the control is disabled with a
        // reason rather than producing a 409 an operator has to interpret.
        const blocked = row.is_active && (self || row.is_staff);
        const why = self
          ? 'You cannot suspend your own account'
          : row.is_staff
            ? 'Remove their operator role first'
            : undefined;

        // Two different variants for two different acts. Suspend takes access
        // away, so it is the quieter control that only turns red under the
        // pointer; Reinstate restores it and reads as an ordinary button.
        return row.is_active ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={blocked || busyId === row.id}
            title={why}
            className="h-control text-muted-foreground hover:bg-destructive-subtle hover:text-destructive-subtle-foreground disabled:cursor-not-allowed sm:h-control-sm"
            leftIcon={<Ban className="size-3.5" aria-hidden />}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(row, true);
            }}
          >
            Suspend
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={busyId === row.id}
            className="h-control sm:h-control-sm"
            leftIcon={<RotateCcw className="size-3.5" aria-hidden />}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(row, false);
            }}
          >
            Reinstate
          </Button>
        );
      },
    },
  ];
}

/** A compact operator count for the home page's people panel. */
export function OperatorCount() {
  const { data } = useInfiniteQuery({
    queryKey: ['admin', 'users', { search: '', role: 'staff' }],
    queryFn: () => fetchAdminUsers({ role: 'staff' }),
    initialPageParam: null as string | null,
    getNextPageParam: () => null,
    staleTime: 300_000,
  });
  const count = data?.pages[0]?.data.length ?? 0;
  return (
    <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
      <ShieldCheck className="size-3.5" aria-hidden />
      {count} operator{count === 1 ? '' : 's'}
    </span>
  );
}
