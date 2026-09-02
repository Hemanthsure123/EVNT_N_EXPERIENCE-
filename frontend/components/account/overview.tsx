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
import { cn } from '@/lib/utils/cn';
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
 * The identity medallion is the warm cream circle used everywhere a person is
 * represented now, replacing the violet→pink gradient.
 */
export function AccountOverview() {
  const { user } = useAuth();
  const { organizations, isOrganizer } = useScope();
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
  const memberSince = user?.date_joined
    ? new Date(user.date_joined).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
    : null;

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
          {/* `truncate` has to be on the TEXT, not on the flex container: a
              flex parent does not clip its child, so a long address ran past
              the edge of the screen mid-word with no ellipsis to say it had
              been cut. */}
          <p className="flex items-center gap-1.5 text-body-sm text-muted-foreground">
            <Mail className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{user?.email}</span>
          </p>
          {/* "Member since" was a KPI TILE — a third of a three-up row, next to
              two numbers somebody navigates by. It is not a metric and nothing
              acts on it: it is a fact about this profile, so it sits with the
              profile. Moving it here is what buys the two tiles that ARE
              navigational the width they need. */}
          {memberSince ? (
            <p className="truncate text-caption text-foreground-subtle">Member since {memberSince}</p>
          ) : null}
        </div>
      </header>

      {/* ── THREE TILES DID NOT FIT, AND EVERY LINE PROVED IT ─────────────
          `grid-cols-3` on a 390px screen leaves each tile about 113px, less
          padding — under which every string in it was clipped by its own
          `truncate`:

              SAVED EVEN…   MEMBER SI…   Aug 2…   20 ready to u…

          and the bookmark icon, absolutely positioned at `right-3 top-3`, sat
          ON TOP of the label it was meant to annotate. Four separate defects
          from one column too many.

          TWO tiles now, because only two of the three were ever navigational —
          "Member since" moved up to the profile line where it belongs. That is
          not a smaller row, it is the right row: these are the two places
          somebody goes from here, so they read as destinations, with a chevron
          each rather than a decorative icon competing with the text.

          Still a `<ul>` of `<li>`: it is a list of facts, and both lead
          somewhere. */}
      <ul className="grid grid-cols-2 gap-3 sm:gap-stack-lg">
        <Stat
          label="Tickets"
          value={tickets.isPending ? null : `${rows.length}${more ? '+' : ''}`}
          hint={ready > 0 ? `${ready} ready to use` : 'None ready to use'}
          href="/account/tickets"
          icon={<TicketIcon className="size-4" />}
        />
        <Stat
          label="Saved"
          value={savedIds === null ? null : String(savedIds.length)}
          hint={savedIds?.length === 1 ? '1 event kept' : 'Events you kept'}
          href="/account/saved"
          icon={<Bookmark className="size-4" />}
        />
      </ul>

      {isOrganizer ? (
        <Panel
          title="Your organisations"
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
        />
        <Shortcut
          href="/account/saved"
          icon={Bookmark}
          title="Saved events"
        />
      </div>

      {/* A paragraph here used to list the fields the account record does not
          hold, name the `User` model, and cite three backlog items. On a
          customer's own overview.
          Some of it is now simply wrong — a phone number IS on the account and
          editable in settings — which is the second cost of shipping this kind
          of copy: it describes a snapshot of the code, so it rots the moment
          the code moves, in the place a reader is least able to tell. */}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  href,
  icon,
  className,
}: {
  label: string;
  value: string | null;
  /** Optional: several cards read better with the label alone. */
  hint?: string;
  href?: string;
  icon?: React.ReactNode;
  className?: string;
}) {
  const body = (
    <div className="flex h-full flex-col gap-1">
      {/* The icon LEADS the label instead of floating over it. Absolutely
          positioned at `right-3 top-3` it overlapped the very text it
          annotated the moment the tile narrowed. */}
      <p
        className={cn(
          'flex items-center gap-1.5 text-caption font-medium uppercase tracking-wide text-foreground-subtle',
          // Clearance for the chevron, so the label can never run under it —
          // which is the failure the old absolutely-positioned icon had.
          href && 'pr-5',
        )}
      >
        {icon ? (
          <span aria-hidden className="shrink-0 text-muted-foreground">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 truncate">{label}</span>
      </p>
      {value === null ? (
        <Skeleton className="h-8 w-16" />
      ) : (
        // NOT truncated. A count clipped to "2…" is worse than one that wraps,
        // and these are two or three characters wide.
        <p className="text-h3 font-bold tabular-nums">{value}</p>
      )}
      {/* `line-clamp-2` rather than `truncate`: a hint is a sentence, and
          "20 ready to u…" answered nothing. */}
      {hint ? (
        <p className="mt-auto line-clamp-2 pt-1 text-caption text-muted-foreground">{hint}</p>
      ) : null}
      {href ? (
        <span
          aria-hidden
          className="pointer-events-none absolute right-3 top-3 text-foreground-subtle transition-transform duration-fast group-hover:translate-x-0.5"
        >
          <ArrowRight className="size-4" />
        </span>
      ) : null}
    </div>
  );

  return (
    <li
      className={cn(
        'group relative rounded-2xl border border-border bg-surface p-card shadow-sm',
        // A tile that navigates should feel like it does.
        href && 'transition-colors duration-fast hover:border-border-strong hover:bg-muted/40',
        className,
      )}
    >
      {href ? (
        <Link
          href={href}
          className="block h-full rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
  /** Optional: a card whose title says it all does not need a second line. */
  body?: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3.5 rounded-2xl border border-border bg-surface p-4 shadow-sm transition-shadow duration-fast hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
    >
      <span
        aria-hidden
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary"
      >
        <Icon className="size-5 text-secondary-foreground" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-sm font-semibold">{title}</span>
        {body ? <span className="block text-caption text-muted-foreground">{body}</span> : null}
      </span>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
