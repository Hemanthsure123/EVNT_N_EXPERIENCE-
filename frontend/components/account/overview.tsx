'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Bookmark, Building2, Mail, Ticket as TicketIcon } from 'lucide-react';
import { api } from '@/lib/api/client';
import { avatarUrlOf } from '@/lib/api/profile';
import type { Paginated } from '@/lib/api/types';
import { useAuth } from '@/lib/auth/auth-provider';
import { useScope } from '@/lib/identity/scope';
import { useSavedEventIds } from '@/lib/discovery/use-favourites';
import { IdentityAvatar } from '@/components/ui';
import { Panel, Skeleton } from '@/components/organizer/primitives';

/**
 * Account overview.
 *
 * ── EVERY FIELD HERE IS ONE THE SERVER MAINTAINS ──────────────────────────
 *
 * `UserSerializer` returns id, email, full_name, avatar_url, is_organizer,
 * is_staff, email_verified and date_joined. That is the whole identity record.
 *
 * A PROFILE PICTURE is now one of them — `User.avatar_url` is a real column with
 * `POST`/`DELETE /auth/me/avatar` behind it — so the medallion here shows it. The
 * CONTROL that changes it lives in Settings → Profile (`AvatarUpload`), not on
 * this page: nothing on this page writes, and an upload panel is the one thing
 * that should not have two homes — two copies is how one of them keeps a stale
 * picture. What this page owes the feature is the picture itself, from the same
 * cached profile the header reads.
 *
 * The rest of what the brief asked for still does not exist: no city on `User`,
 * and no category column anywhere yet (BACKLOG item 2). A city field that
 * discarded what was typed would be worse than its absence, so this shows what
 * is true and names the remaining gaps once, at the bottom, rather than faking
 * them. Design system §13.6.
 *
 * ── HIERARCHY: NAME, THEN NUMBERS, THEN DOORS, THEN THE CAVEAT ────────────
 *
 * Nothing on this page is a completable action, so nothing on it wears the
 * near-black `--cta` pill — the whole screen is navigation. What carries the
 * hierarchy instead is size and surface: an `h2` name, then three stat cards
 * that lift off the white canvas on a hairline plus `shadow-sm`, then two
 * shortcut cards, then the honesty note recessed into `bg-sunken` so it reads
 * as a footnote rather than as another card. The identity medallion is the
 * warm cream circle used everywhere a person is represented now, replacing the
 * violet→pink gradient.
 */
export function AccountOverview() {
  const { user } = useAuth();
  const { organizations, isOrganizer, isAdmin } = useScope();
  const savedIds = useSavedEventIds();

  // The first page only — the overview needs a count and a sense of scale,
  // not every ticket. The Tickets page paginates properly.
  const tickets = useQuery({
    queryKey: ['account', 'tickets', 'first-page'],
    queryFn: () => api.get<Paginated<{ id: string; status: string }>>('/me/tickets'),
    staleTime: 30_000,
  });

  const rows = tickets.data?.data ?? [];
  const ready = rows.filter((ticket) => ticket.status === 'active').length;
  // A cursor list gives no total, so the count is rendered as a FLOOR — the
  // same rule the browse page follows rather than inventing a total.
  const more = Boolean(tickets.data?.meta.next);

  return (
    <div className="flex flex-col gap-block lg:gap-block-lg">
      <header className="flex items-center gap-4">
        {/* The same `IdentityAvatar` the header trigger and the account menu
            render, reading the same cached profile — so a picture uploaded in
            Settings appears on all three on one render, and there is nowhere for
            a stale copy to live. */}
        <IdentityAvatar
          name={user?.full_name || user?.email || '?'}
          imageUrl={avatarUrlOf(user)}
          size="lg"
        />
        <div className="min-w-0">
          <h1 className="truncate text-h3 md:text-h2">{user?.full_name || 'Your account'}</h1>
          <p className="flex items-center gap-1.5 truncate text-body-sm text-muted-foreground">
            <Mail className="size-3.5 shrink-0" aria-hidden />
            {user?.email}
          </p>
        </div>
      </header>

      <ul className="grid grid-cols-2 gap-stack sm:grid-cols-3 sm:gap-stack-lg">
        <Stat
          label="Tickets"
          value={tickets.isPending ? null : `${rows.length}${more ? '+' : ''}`}
          hint={ready > 0 ? `${ready} ready to use` : 'None ready to use'}
          href="/account/tickets"
        />
        <Stat
          label="Saved events"
          value={savedIds === null ? null : String(savedIds.length)}
          hint="Kept on this device"
          href="/account/saved"
        />
        <Stat
          label="Member since"
          value={
            user?.date_joined
              ? new Date(user.date_joined).toLocaleDateString('en-IN', {
                  month: 'short',
                  year: 'numeric',
                })
              : null
          }
          hint="Thanks for being here"
        />
      </ul>

      {isOrganizer ? (
        <Panel
          title="Your organisations"
          subtitle="Switch scope from the avatar menu at any time"
          className="shadow-sm"
        >
          <ul className="divide-y divide-border">
            {organizations.map((organization) => (
              <li key={organization.id}>
                <Link
                  href="/dashboard"
                  className="flex min-h-control items-center gap-3 px-card py-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span
                    aria-hidden
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground"
                  >
                    <Building2 className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-sm font-semibold">
                      {organization.name}
                    </span>
                    <span className="block truncate text-caption text-foreground-subtle">
                      {organization.verified_level === 'verified'
                        ? 'Verified organiser'
                        : 'Verification not yet approved'}
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="grid gap-stack-lg sm:grid-cols-2">
        <Shortcut
          href="/account/tickets"
          icon={TicketIcon}
          title="My tickets"
          body="Show a code at the gate, or check what is coming up."
        />
        <Shortcut
          href="/account/saved"
          icon={Bookmark}
          title="Saved events"
          body="Everything you bookmarked while browsing."
        />
      </div>

      {/* Recessed rather than raised: this is a footnote about what the data
          model does NOT hold, and drawing it as another lifted card would give
          it the same weight as the things that are true. */}
      <p className="rounded-xl border border-border bg-sunken p-card text-caption text-muted-foreground">
        A phone number, city and preferred categories are not shown because the account record
        does not expose them — <code>User</code> holds an email, a name, a picture and role flags.
        Phone verification, connected accounts, active sessions and account deletion each need
        endpoints that do not exist yet; BACKLOG items 37–39 name them.
        {isAdmin ? ' Your operator access is real, and enforced on every admin endpoint.' : ''}
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string | null;
  hint: string;
  href?: string;
}) {
  const body = (
    <>
      <p className="truncate text-caption font-medium uppercase tracking-wide text-foreground-subtle">
        {label}
      </p>
      {value === null ? (
        <Skeleton className="my-1 h-8 w-16" />
      ) : (
        <p className="mt-1 truncate text-h3 tabular-nums">{value}</p>
      )}
      <p className="truncate text-caption text-muted-foreground">{hint}</p>
    </>
  );

  return (
    // A white card on a white canvas separates by hairline + shadow, never by
    // value — see the elevation note in tokens.css.
    <li className="rounded-xl border border-border bg-surface p-card shadow-sm">
      {href ? (
        <Link
          href={href}
          className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

function Shortcut({
  href,
  icon: Icon,
  title,
  body,
}: {
  href: string;
  icon: typeof TicketIcon;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-start gap-3 rounded-xl border border-border bg-surface p-card shadow-sm transition-shadow duration-fast hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
    >
      <span
        aria-hidden
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary"
      >
        <Icon className="size-4 text-secondary-foreground" />
      </span>
      <span className="min-w-0">
        <span className="block text-body-sm font-semibold">{title}</span>
        <span className="block text-caption text-muted-foreground">{body}</span>
      </span>
    </Link>
  );
}
