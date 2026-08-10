'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  CornerDownLeft,
  CreditCard,
  Loader2,
  Search,
  Stamp,
  Undo2,
  Users,
  Wallet,
} from 'lucide-react';
import { Modal, ModalContent } from '@/components/ui/modal';
import {
  fetchAdminOrganizations,
  fetchAdminPayments,
  fetchAdminRefunds,
  fetchAdminSettlements,
  fetchAdminUsers,
  fetchModerationQueue,
} from '@/lib/api/admin';
import { ADMIN_SECTIONS } from '@/lib/admin/nav';
import { trapTab, useBackgroundInert } from '@/lib/utils/focus-trap';
import { useDebouncedValue } from '@/lib/utils/use-debounced-value';
import { cn } from '@/lib/utils/cn';

/**
 * ⌘K, and it searches REAL records.
 *
 * Sections always match locally so navigation is instant and works offline.
 * Organizations and users come from `/admin/organizations` and `/admin/users`
 * — the console's own paginated lists, filtered server-side — so a result is
 * something an operator can actually open.
 *
 * SIX SOURCES, all real: sections, organizations, users, events awaiting
 * review, payments and refunds. Every one hits the endpoint its own screen
 * uses, so a result here can never be something the console cannot open.
 *
 * WHAT IT DOESN'T SEARCH, and why each omission is deliberate:
 *
 * - **Bookings and tickets** have no admin lookup endpoint (only
 *   `GET /bookings/{id}`, scoped to the booking's own owner), so there is
 *   nothing to query. An empty "Bookings" group would teach an operator the
 *   platform has no bookings. BACKLOG item 56.
 * - **Support tickets** do not exist as a model at all. BACKLOG item 49.
 * - **CMS content** is a single homepage record plus a category list, both one
 *   click away in the sidebar — a search group for two items is noise.
 *
 * PAYMENTS AND REFUNDS take a `q` server-side; SETTLEMENTS and MODERATION do
 * not, so those two are matched locally over their first page. That split is
 * deliberate rather than sloppy: the first two are unbounded, and the second
 * two are small per-platform lists where a round trip per keystroke would buy
 * nothing.
 *
 * `modal={false}` with a hand-rolled trap, for the reason documented in
 * `lib/utils/focus-trap.ts`: Radix's modal mode invalidates style and layout
 * for the whole document, and this is the control an operator hits most.
 *
 * THE HIGHLIGHTED ROW IS THE WARM `--nav-active` PILL — the same "this is the
 * one" fill as the active sidebar item and an applied filter. It was
 * `bg-muted`, which is also the HOVER fill of every other row here, so the
 * keyboard cursor and an idle mouse looked identical and Enter was a guess.
 * It is deliberately not the near-black CTA: there are up to thirty of these
 * on screen and none of them is a primary action, they are destinations.
 */

const MIN_QUERY = 2;
const DEBOUNCE_MS = 200;

type Row = { id: string; label: string; hint: string; href: string; icon: typeof Search };

export function AdminCommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const debounced = useDebouncedValue(query.trim(), DEBOUNCE_MS);
  const panelRef = React.useRef<HTMLDivElement>(null);
  useBackgroundInert(open);

  React.useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const remote = useQuery({
    queryKey: ['admin-search', debounced],
    // Each source catches its OWN failure. One endpoint being down must
    // degrade to a missing group, never to an empty palette — search is how an
    // operator navigates when something is already wrong.
    queryFn: async () => {
      const [orgs, users, payments, refunds, settlements, moderation] = await Promise.all([
        fetchAdminOrganizations().catch(() => ({ data: [] })),
        fetchAdminUsers({ q: debounced }).catch(() => ({ data: [] })),
        fetchAdminPayments({ q: debounced }).catch(() => ({ data: [] })),
        fetchAdminRefunds({ q: debounced }).catch(() => ({ data: [] })),
        fetchAdminSettlements().catch(() => ({ data: [] })),
        fetchModerationQueue({ status: 'pending_review' }).catch(() => ({ data: [] })),
      ]);
      return {
        orgs: orgs.data,
        users: users.data,
        payments: payments.data,
        refunds: refunds.data,
        settlements: settlements.data,
        moderation: moderation.data,
      };
    },
    enabled: open && debounced.length >= MIN_QUERY,
    staleTime: 10_000,
  });

  const needle = debounced.toLowerCase();
  const rows: Row[] = React.useMemo(() => {
    const sections: Row[] = ADMIN_SECTIONS.filter(
      (section) => !needle || section.label.toLowerCase().includes(needle),
    ).map((section) => ({
      id: `section:${section.href}`,
      label: section.label,
      hint: section.hint,
      href: section.href,
      icon: section.icon,
    }));

    if (needle.length < MIN_QUERY) return sections;

    const orgs: Row[] = (remote.data?.orgs ?? [])
      .filter((org) => org.name.toLowerCase().includes(needle))
      .slice(0, 5)
      .map((org) => ({
        id: `org:${org.id}`,
        label: org.name,
        hint: `Organization · ${org.verified_level}`,
        href: `/admin/organizations?highlight=${org.id}`,
        icon: Building2,
      }));

    const users: Row[] = (remote.data?.users ?? []).slice(0, 5).map((user) => ({
      id: `user:${user.id}`,
      label: user.full_name || user.email,
      hint: [
        'User',
        user.email,
        user.is_staff ? 'operator' : user.is_organizer ? 'organizer' : null,
        // Worth surfacing in search: an operator looking somebody up is often
        // doing it BECAUSE the account is suspended.
        user.is_active ? null : 'suspended',
      ]
        .filter(Boolean)
        .join(' · '),
      href: `/admin/users?highlight=${user.id}`,
      icon: Users,
    }));

    const payments: Row[] = (remote.data?.payments ?? []).slice(0, 4).map((payment) => ({
      id: `payment:${payment.id}`,
      label: payment.provider_payment_id || payment.provider_order_id || payment.customer_email,
      hint: `Payment · ${payment.status} · ${payment.customer_email}`,
      href: `/admin/payments?highlight=${payment.id}`,
      icon: CreditCard,
    }));

    const refunds: Row[] = (remote.data?.refunds ?? []).slice(0, 4).map((refund) => ({
      id: `refund:${refund.id}`,
      label: refund.provider_ref || refund.customer_email,
      hint: `Refund · ${refund.is_partial ? 'partial' : 'full'} · ${refund.event_title}`,
      href: `/admin/payments?highlight=${refund.id}`,
      icon: Undo2,
    }));

    // Matched locally — these two endpoints take no `q`, and both are small
    // per-platform lists.
    const settlements: Row[] = (remote.data?.settlements ?? [])
      .filter((row) => row.event_title.toLowerCase().includes(needle))
      .slice(0, 4)
      .map((row) => ({
        id: `settlement:${row.id}`,
        label: row.event_title,
        hint: `Payout · ${row.status}`,
        href: `/admin/settlements?highlight=${row.id}`,
        icon: Wallet,
      }));

    const pending: Row[] = (remote.data?.moderation ?? [])
      .filter(
        (row) =>
          row.title.toLowerCase().includes(needle) ||
          row.organization_name.toLowerCase().includes(needle),
      )
      .slice(0, 4)
      .map((row) => ({
        id: `moderation:${row.id}`,
        label: row.title,
        hint: `Awaiting review · ${row.organization_name}`,
        href: `/admin/moderation?highlight=${row.id}`,
        icon: Stamp,
      }));

    return [...sections, ...pending, ...orgs, ...users, ...payments, ...refunds, ...settlements];
  }, [needle, remote.data]);

  React.useEffect(() => setActive(0), [rows.length]);

  const go = (row: Row) => {
    onOpenChange(false);
    router.push(row.href);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    trapTab(event, panelRef.current);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (rows.length ? (index + 1) % rows.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (rows.length ? (index - 1 + rows.length) % rows.length : 0));
    } else if (event.key === 'Enter') {
      const row = rows[active];
      if (row) {
        event.preventDefault();
        go(row);
      }
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} modal={false}>
      <ModalContent
        ref={panelRef}
        onKeyDown={onKeyDown}
        aria-label="Console search"
        className="top-24 max-w-xl translate-y-0 gap-0 p-0"
      >
        {/* `pr-12` clears the ModalContent close button, which sits at
            `right-4 top-4` and otherwise lands on top of the input's own text
            and the fetching spinner. */}
        <div className="flex items-center gap-3 border-b border-border pl-4 pr-12">
          <Search className="size-4 shrink-0 text-primary" aria-hidden />
          {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the palette exists to be typed into */}
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search sections, organizations, users…"
            aria-label="Search the console"
            role="combobox"
            aria-expanded
            aria-controls="admin-command-results"
            aria-activedescendant={rows[active] ? `cmd-${rows[active].id}` : undefined}
            className="h-14 w-full bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground"
          />
          {remote.isFetching ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
          ) : null}
        </div>

        <ul id="admin-command-results" role="listbox" className="max-h-80 overflow-y-auto p-2">
          {rows.map((row, index) => {
            const selected = index === active;
            return (
              <li key={row.id}>
                <button
                  id={`cmd-${row.id}`}
                  role="option"
                  aria-selected={selected}
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => go(row)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-fast',
                    selected ? 'bg-nav-active' : 'hover:bg-muted',
                  )}
                >
                  <row.icon
                    className={cn(
                      'size-4 shrink-0',
                      selected ? 'text-nav-active-foreground' : 'text-muted-foreground',
                    )}
                    aria-hidden
                  />
                  <span className="flex min-w-0 flex-col">
                    <span
                      className={cn(
                        'truncate text-body-sm',
                        selected ? 'font-medium text-nav-active-foreground' : 'text-foreground',
                      )}
                    >
                      {row.label}
                    </span>
                    <span
                      className={cn(
                        'truncate text-caption',
                        // A ratio that can be computed rather than an opacity
                        // over whatever happens to be behind it: 7.0:1 on the
                        // cream pill in light, and its dark partner in dark.
                        selected ? 'text-nav-active-foreground/75' : 'text-muted-foreground',
                      )}
                    >
                      {row.hint}
                    </span>
                  </span>
                  {selected ? (
                    <CornerDownLeft
                      className="ml-auto size-3.5 shrink-0 text-nav-active-foreground"
                      aria-hidden
                    />
                  ) : null}
                </button>
              </li>
            );
          })}

          {!rows.length ? (
            <li className="px-3 py-6 text-center text-body-sm text-muted-foreground">
              {debounced.length < MIN_QUERY
                ? 'Type at least two characters.'
                : `Nothing matches “${debounced}”.`}
            </li>
          ) : null}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-caption text-muted-foreground">
          {/* Still says what it CANNOT search. An operator who knows the gap
              stops retyping a booking reference into it. */}
          <p className="min-w-0">
            Sections, organizations, users, payments, refunds, payouts and events in review.
          </p>
          <p className="flex shrink-0 items-center gap-1.5">
            <Key>↑↓</Key>
            move
            <Key>↵</Key>
            open
            <Key>esc</Key>
            close
          </p>
        </div>
      </ModalContent>
    </Modal>
  );
}

/** A keycap. Pill-shaped like everything else, and never more than a hint. */
function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-full border border-border px-1.5 py-0.5 text-caption text-foreground-subtle">
      {children}
    </kbd>
  );
}
