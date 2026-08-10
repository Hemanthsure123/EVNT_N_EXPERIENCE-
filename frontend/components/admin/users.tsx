'use client';

import * as React from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, RotateCcw, ShieldCheck, ShieldOff, Users } from 'lucide-react';
import {
  fetchAdminUsers,
  revokeUserVerification,
  setUserOperator,
  setUserSuspended,
  type AdminUser,
  type UserRole,
} from '@/lib/api/admin';
import { cursorFromNextLink } from '@/lib/api/events';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useAuth } from '@/lib/auth/auth-provider';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  Input,
  Label,
} from '@/components/ui';
import { useDataTable, type ColumnDef } from '@/lib/organizer/table';
import { useConsoleDateWindow } from '@/components/admin/filters';
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
  const [revoking, setRevoking] = React.useState<AdminUser | null>(null);
  const [revokeReason, setRevokeReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const search = useDebouncedValue(term.trim(), 250);
  const dates = useConsoleDateWindow();

  const query = useInfiniteQuery({
    queryKey: ['admin', 'users', { search, role, dates: dates.key }],
    queryFn: ({ pageParam }) =>
      fetchAdminUsers({
        q: search || undefined,
        role: role || undefined,
        // On `date_joined`, which is what this list orders by — a window on a
        // different column than the ordering makes the filter and the cursor
        // disagree about which rows a page holds.
        ...dates.window,
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

  const setOperator = React.useCallback(
    async (row: AdminUser, isStaff: boolean) => {
      setBusyId(row.id);
      setError(null);
      try {
        await setUserOperator(row.id, isStaff);
        void client.invalidateQueries({ queryKey: ['admin', 'users'] });
        offer({
          message: `${row.email} is ${isStaff ? 'now an operator' : 'no longer an operator'}`,
          // The COMPENSATING write, and it is genuinely reversible: the role
          // is a boolean and putting it back restores exactly what was there.
          // That is what makes undo the right affordance here where revoking a
          // verification gets a confirmation instead.
          undo: async () => {
            await setUserOperator(row.id, !isStaff);
            void client.invalidateQueries({ queryKey: ['admin', 'users'] });
          },
        });
      } catch (thrown) {
        setError(errorMessage(thrown));
      } finally {
        setBusyId(null);
      }
    },
    [client, offer],
  );

  const revoke = React.useCallback(
    async (row: AdminUser, reason: string) => {
      setBusyId(row.id);
      setError(null);
      try {
        await revokeUserVerification(row.id, reason);
        void client.invalidateQueries({ queryKey: ['admin', 'users'] });
        setRevoking(null);
        setRevokeReason('');
      } catch (thrown) {
        // The server's own message names the refusal ("you cannot revoke your own"),
        // which is more use than anything written here.
        setError(errorMessage(thrown));
      } finally {
        setBusyId(null);
      }
    },
    [client],
  );

  const columns = React.useMemo(
    () =>
      buildColumns({
        meId: me?.id ?? '',
        busyId,
        onToggle: setSuspended,
        onRevoke: setRevoking,
        onOperator: setOperator,
      }),
    [me?.id, busyId, setSuspended, setOperator],
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

      <Drawer
        open={Boolean(revoking)}
        onOpenChange={(open) => {
          if (!open) {
            setRevoking(null);
            setRevokeReason('');
          }
        }}
      >
        <DrawerContent side="responsive" className="sm:max-w-md">
          <DrawerTitle className="text-h4">Revoke this verification?</DrawerTitle>
          {/* A CONFIRMATION rather than the undo this console prefers, because
              the write is not reversible from here: the way back is
              reinstating the account and having the person prove their address
              again, which is the whole point of withdrawing the trust. Undo
              would promise a compensating write that does not exist. */}
          <DrawerDescription className="text-body-sm text-muted-foreground">
            {revoking?.email} will be signed out and cannot sign in, or sign up again with this
            address, until an operator reinstates the account and they verify it afresh. They will
            be shown how to contact support.
          </DrawerDescription>

          <div className="mt-stack-lg flex flex-col gap-1.5">
            <Label htmlFor="revoke-reason">
              Reason <span className="font-normal text-muted-foreground">— for the audit trail</span>
            </Label>
            <Input
              id="revoke-reason"
              value={revokeReason}
              maxLength={500}
              onChange={(event) => setRevokeReason(event.target.value)}
              placeholder="Chargeback fraud"
            />
            {/* It is never shown to the person it is about: an operator's note
                is written for the next operator, and rendering it to them
                would publish an internal judgement. */}
            <p className="text-caption text-muted-foreground">
              Recorded against your account. The person never sees it.
            </p>
          </div>

          <div className="mt-block flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setRevoking(null);
                setRevokeReason('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!revoking || busyId === revoking.id}
              loading={Boolean(revoking && busyId === revoking.id)}
              onClick={() => revoking && void revoke(revoking, revokeReason.trim())}
            >
              Revoke verification
            </Button>
          </div>
        </DrawerContent>
      </Drawer>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <TableToolbar>
          <SearchField
            value={term}
            onChange={setTerm}
            placeholder="Name or email"
            label="Search accounts"
          />
          {dates.control}
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
  onRevoke,
  onOperator,
}: {
  meId: string;
  busyId: string | null;
  onToggle: (row: AdminUser, suspended: boolean) => void;
  onRevoke: (row: AdminUser) => void;
  onOperator: (row: AdminUser, isStaff: boolean) => void;
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
      width: 150,
      // Operators first, then organizers, then attendees — the order an
      // operator scanning for privilege would want.
      sortValue: (row) => (row.is_staff ? 'a' : row.is_organizer ? 'b' : 'c'),
      render: (row) =>
        // The primary account says so on its own row. Without it the missing
        // role control reads as a rendering fault rather than as a rule — and
        // "why can I not demote this one" is a question worth answering in
        // place rather than in a 409.
        row.is_superuser ? (
          <StatusPill tone="info">Primary admin</StatusPill>
        ) : row.is_staff ? (
          <StatusPill tone="info">Operator</StatusPill>
        ) : row.is_organizer ? (
          <StatusPill tone="warning">Organizer</StatusPill>
        ) : (
          <StatusPill tone="neutral">Attendee</StatusPill>
        ),
      exportValue: (row) =>
        row.is_superuser
          ? 'primary admin'
          : row.is_staff
            ? 'operator'
            : row.is_organizer
              ? 'organizer'
              : 'attendee',
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
      key: 'verified',
      header: 'Address',
      width: 130,
      sortValue: (row) => (row.email_verified ? 1 : 0),
      // Its own column rather than folded into Access, because they are two
      // different blocks with two different fixes: an operator suspended this
      // account, or nobody ever clicked the code. One pill could not say which.
      render: (row) =>
        row.email_verified ? (
          <StatusPill tone="success">Verified</StatusPill>
        ) : (
          <StatusPill tone="warning">Unverified</StatusPill>
        ),
      exportValue: (row) => (row.email_verified ? 'verified' : 'unverified'),
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
      width: 360,
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
        return (
          <span className="flex items-center gap-1">
            {row.is_active ? (
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
            )}
            {/* The role. Absent for your OWN row: the server refuses a
                self-demotion (you would lose the console that could put it
                back), so rendering it would be a control that can only fail.
                Absent for an unverified or suspended account for the same
                reason — the server refuses those too. */}
            {/* `!row.is_superuser` is the load-bearing half. The primary
                account's role is fixed for EVERYBODY — the server refuses it —
                so rendering the control here would be a button whose only
                possible outcome is a 409 on the one row where getting it
                wrong costs the platform its way back in. */}
            {!self && !row.is_superuser && row.is_active && (row.is_staff || row.email_verified) ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busyId === row.id}
                title={
                  row.is_staff
                    ? 'Remove the operator role'
                    : 'Give this account access to the console'
                }
                className="h-control text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed sm:h-control-sm"
                leftIcon={<ShieldCheck className="size-3.5" aria-hidden />}
                onClick={(event) => {
                  event.stopPropagation();
                  onOperator(row, !row.is_staff);
                }}
              >
                {row.is_staff ? 'Remove operator' : 'Make operator'}
              </Button>
            ) : null}
            {/* Offered only while the address is still trusted — revoking a
                revocation is not an operation, and a control whose job is to
                fail is worse than no control. */}
            {row.email_verified ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={blocked || busyId === row.id}
                title={why ?? 'Untrust this address and take the account out of service'}
                className="h-control text-muted-foreground hover:bg-destructive-subtle hover:text-destructive-subtle-foreground disabled:cursor-not-allowed sm:h-control-sm"
                leftIcon={<ShieldOff className="size-3.5" aria-hidden />}
                onClick={(event) => {
                  event.stopPropagation();
                  onRevoke(row);
                }}
              >
                Revoke
              </Button>
            ) : null}
          </span>
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
