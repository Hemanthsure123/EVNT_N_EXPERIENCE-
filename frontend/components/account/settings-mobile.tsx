'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  BellRing,
  Building2,
  Check,
  ChevronRight,
  Headset,
  KeyRound,
  LifeBuoy,
  LogOut,
  Monitor,
  Moon,
  Pencil,
  QrCode,
  ShieldCheck,
  Store,
  Sun,
  Ticket as TicketIcon,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { avatarUrlOf } from '@/lib/api/profile';
import type { Paginated } from '@/lib/api/types';
import { useAuth } from '@/lib/auth/auth-provider';
import { useScope } from '@/lib/identity/scope';
import { useSavedEventIds } from '@/lib/discovery/use-favourites';
import { usePush } from '@/lib/push/use-push';
import { useTheme, type Theme } from '@/lib/theme/theme-provider';
import { IdentityAvatar } from '@/components/ui';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils/cn';
import { sectionHref } from './settings-sections';

/**
 * `/account/settings` on a phone.
 *
 * ── WHY THIS IS A SEPARATE COMPONENT FROM THE DESKTOP SETTINGS SCREEN ─────
 *
 * From `lg` up, settings is a rail of five destinations beside one section — an
 * application frame shared with the organizer and admin consoles, and untouched
 * by this file. Below `lg` it is a SINGLE SCROLLING STACK: who you are, what
 * you are holding, then three grouped lists of rows. The two are not one layout
 * at two widths, they are two layouts, and expressing the second as a narrow
 * version of the first is exactly what produced the screen this replaces — a
 * page title over a grid of five identical section cards, with nothing on it
 * that anybody had come to do.
 *
 * The drill-down is intact. A row with a chevron goes to `?section=…`, the same
 * URL the desktop rail writes, so a link shared from either lands in the same
 * place. This component renders only while NOTHING is chosen: it IS the index
 * (see `resolveSection` in `settings-sections.ts`).
 *
 * ── EVERY NUMBER, BADGE AND CARD HERE IS BACKED BY A REAL ROW ─────────────
 *
 * The reference this was built to carries a membership tier, an attendance
 * count, saved payment methods, a profile-completion percentage and a
 * support-agent presence dot. None of those exist on this platform, and the
 * house rule is that a section nothing backs is ABSENT rather than empty or
 * invented. So:
 *
 *   · the medallion's tick is `user.email_verified`, not decoration;
 *   · the two stats are the ACTIVE passes on the first page of `/me/tickets`
 *     (a floor — `12+` — because a cursor list has no total) and the saved-event
 *     set the browser already holds;
 *   · the dark membership card is an ORGANISATION the person actually owns,
 *     carrying its real verification level — absent for everybody else;
 *   · the pass card is their next active ticket — absent when they hold none;
 *   · the reminders switch is the push subscription, which is real, refuses to
 *     move where the deployment has no keys, and reaches `on` only once the
 *     SERVER stored it. There is still no notification-PREFERENCE toggle
 *     anywhere on this page, because there is still nothing to store one in.
 *
 * ── AND ONE THING THE REFERENCE HAS THAT IS DELIBERATELY MISSING ──────────
 *
 * No app-version line under the sign-out button. No build identifier is plumbed
 * to the client, and a hard-coded `v2.8.4` is precisely the confident lie this
 * codebase refuses everywhere else. The address you are signed in as goes
 * there instead, which is the thing somebody actually checks at the bottom of a
 * settings screen.
 */
export function MobileSettings() {
  return (
    // `relative` gives the ambient field something to fill; `overflow-hidden`
    // stops its blurred edges widening the document, which is the classic way a
    // decorative blob buys a phone a horizontal scrollbar.
    <div className="relative -mt-2 min-w-0 overflow-hidden lg:hidden">
      <AmbientField />

      <div className="relative flex flex-col gap-block pb-2">
        <ProfileHero />
        <ScopeSwitch />
        <OrganisationCard />
        <PassSpotlight />
        <AccountGroup />
        <ExperienceGroup />
        <SupportGroup />
        <SessionActions />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ the backdrop */

/**
 * Three quiet fields behind the stack.
 *
 * Deliberately NOT `components/discovery/aurora.tsx`: that one is tuned to sit
 * behind the front page's LCP artwork at 0.42–0.55 opacity, and would put a
 * violet wash under body copy here. This is the same idea an order of magnitude
 * quieter — enough that a white canvas is not flat behind a column of white
 * cards, not enough to touch a contrast ratio. Every card above it carries its
 * own opaque surface, so no ratio depends on where a blob happens to be.
 */
function AmbientField() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -left-16 -top-20 size-72 rounded-full bg-primary/10 blur-3xl" />
      <div className="absolute -right-20 top-1/3 size-72 rounded-full bg-accent/5 blur-3xl" />
      <div className="absolute -left-8 bottom-24 size-64 rounded-full bg-butter-300/20 blur-3xl" />
    </div>
  );
}

/* ---------------------------------------------------------------- the hero */

function ProfileHero() {
  const { user } = useAuth();
  const { isOrganizer } = useScope();
  const savedIds = useSavedEventIds();
  const tickets = useActiveTickets();

  const memberSince = user?.date_joined
    ? new Date(user.date_joined).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
    : null;

  return (
    <section
      aria-label="Your profile"
      className="relative overflow-hidden rounded-2xl border border-border bg-surface p-card shadow-sm"
    >
      {/* The card's own glow, inside its own rounded clip. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 size-36 rounded-full bg-primary/10 blur-2xl"
      />

      <div className="relative flex items-center gap-4">
        <div className="relative shrink-0">
          {/* The halo is a sibling BEHIND the medallion rather than a ring on
              it: a pulsing box-shadow on the avatar would animate a paint
              property on an image, and this way the scale never touches the
              photograph's own edges. */}
          <div
            aria-hidden
            className="settings-aura pointer-events-none absolute -inset-1.5 rounded-2xl bg-gradient-to-tr from-primary via-accent to-primary blur-md"
          />
          <IdentityAvatar
            name={user?.full_name || user?.email || '?'}
            imageUrl={avatarUrlOf(user)}
            size="lg"
            shape="tile"
            className="relative rounded-2xl border-2 border-border"
          />
          {/* Only where the address has actually been PROVEN. It is the one
              tick this platform can honestly draw on a person. */}
          {user?.email_verified ? (
            <span className="absolute -bottom-1 -right-1 z-10 inline-flex size-5 items-center justify-center rounded-full border-2 border-surface bg-success text-success-foreground">
              <Check className="size-2.5" aria-hidden />
              <span className="sr-only">Email verified</span>
            </span>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="min-w-0 truncate text-body font-bold text-foreground">
              {user?.full_name || 'Your account'}
            </p>
            {/* Slim and borderless. At 390px this row is the name, a pill and an
                edit button inside 326px of card: every pixel the pill spends on
                padding comes straight out of the NAME, and a person's own name
                clipped to "Hemanth Su…" on their own profile is the one string
                here that must not truncate for decoration's sake. */}
            {isOrganizer ? (
              <span className="shrink-0 rounded-full bg-nav-active px-1.5 py-0.5 text-caption font-semibold text-nav-active-foreground">
                Organiser
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-body-sm text-muted-foreground">{user?.email}</p>
          {memberSince ? (
            <p className="mt-1 truncate text-caption text-foreground-subtle">
              Member since {memberSince}
            </p>
          ) : null}
        </div>

        <Link
          href={sectionHref('profile')}
          aria-label="Edit your profile"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-sunken text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
        >
          <Pencil className="size-4" aria-hidden />
        </Link>
      </div>

      {/* Two stats, and both are DOORS. The reference's are inert numbers; a
          count somebody reads on their own account is always the start of
          "show me them", so each one is the link. */}
      <div className="relative mt-4 grid grid-cols-2 border-t border-border pt-4">
        <Stat
          href="/account/tickets"
          label="Active passes"
          value={tickets.pending ? null : `${tickets.active}${tickets.more ? '+' : ''}`}
        />
        <Stat
          href="/account/saved"
          label="Saved events"
          value={savedIds === null ? null : String(savedIds.length)}
          className="border-l border-border"
        />
      </div>
    </section>
  );
}

function Stat({
  href,
  label,
  value,
  className,
}: {
  href: string;
  label: string;
  /** `null` while the count is still arriving — never a zero standing in for
   *  "not known yet", which reads as an answer. */
  value: string | null;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex flex-col items-center gap-0.5 rounded-lg py-1 transition-colors duration-fast hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
        className,
      )}
    >
      {value === null ? (
        <span className="skeleton h-7 w-8 rounded-md" aria-hidden />
      ) : (
        <span className="text-h4 font-bold tabular-nums text-foreground">{value}</span>
      )}
      <span className="text-caption text-muted-foreground">{label}</span>
    </Link>
  );
}

/* -------------------------------------------------------- the scope switch */

/**
 * Attendee ⇄ organiser, as the reference's two-up segmented control.
 *
 * The left half is not a link, because this IS the attendee side of the
 * product — a control that navigates to where you already are is a dead target.
 * The right half goes to the dashboard for somebody who already runs events and
 * to the route that CREATES an organisation for everybody else, which is the
 * rule the account rail already follows: hiding "Host events" from people who
 * are not hosts yet hides it from exactly its audience.
 */
function ScopeSwitch() {
  const { isOrganizer } = useScope();

  return (
    <div className="flex items-center gap-1 rounded-2xl border border-border bg-sunken p-1">
      <span className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-surface px-3 py-2 text-label text-foreground shadow-sm">
        <UserRound className="size-4 text-primary" aria-hidden />
        Attendee
      </span>
      <Link
        href={isOrganizer ? '/dashboard' : '/account/organizer'}
        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-label font-medium text-muted-foreground transition-colors duration-fast hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        <Store className="size-4" aria-hidden />
        {isOrganizer ? 'Organiser console' : 'Host events'}
      </Link>
    </div>
  );
}

/* ----------------------------------------------- the two dark object cards */

/**
 * The wave field the two dark cards share.
 *
 * `preserveAspectRatio="none"` on purpose: this is a texture stretched to fill
 * a card, not a drawing whose proportions carry meaning.
 */
function WaveField() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 size-full opacity-40"
      viewBox="0 0 380 120"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="settings-wave-a" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgb(var(--violet-400))" stopOpacity="0.85" />
          <stop offset="55%" stopColor="rgb(var(--violet-600))" stopOpacity="0.3" />
          <stop offset="100%" stopColor="rgb(var(--butter-300))" stopOpacity="0.6" />
        </linearGradient>
        <linearGradient id="settings-wave-b" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgb(var(--violet-300))" stopOpacity="0.55" />
          <stop offset="100%" stopColor="rgb(var(--violet-500))" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      <path
        className="settings-wave"
        d="M -20,45 C 80,10 160,85 260,35 C 340,0 390,70 430,30"
        fill="none"
        stroke="url(#settings-wave-a)"
        strokeWidth="2.5"
      />
      <path
        className="settings-wave"
        d="M -20,80 C 70,30 180,110 270,55 C 330,20 380,95 430,65"
        fill="none"
        stroke="url(#settings-wave-b)"
        strokeWidth="1.8"
        opacity="0.6"
        style={{ animationDuration: '16s', animationDirection: 'reverse' }}
      />
    </svg>
  );
}

/** The slow glint both dark cards carry. */
function Sheen({ className }: { className?: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className={cn(
          'settings-sheen h-full w-1/2 bg-gradient-to-r from-transparent via-white/15 to-transparent',
          className,
        )}
      />
    </div>
  );
}

/**
 * The membership card's slot — filled by an ORGANISATION, or by nothing.
 *
 * The reference puts a VIP tier here. There is no membership product on this
 * platform and no column that could ever back one, so the premium treatment
 * goes to the thing somebody here genuinely holds that is worth drawing this
 * way: the organisation they own, and where its verification stands. A person
 * with no organisation sees no card at all, which is correct — an empty "you
 * are not a member" panel is an advert for something that does not exist.
 */
function OrganisationCard() {
  const { organizations } = useScope();
  const organization = organizations[0];
  if (!organization) return null;

  const verified = organization.verified_level === 'verified';
  const pending = organization.verified_level === 'pending';

  return (
    <Link
      href="/dashboard"
      className="group relative block overflow-hidden rounded-2xl border border-violet-500/25 bg-gradient-to-br from-violet-900 via-ink-900 to-ink-950 p-4 shadow-md transition-colors duration-fast hover:border-violet-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
    >
      <Sheen />
      <WaveField />

      <div className="relative flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-violet-400/30 bg-violet-500/20 text-violet-200"
          >
            <Building2 className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-label uppercase tracking-wide text-violet-100">
              {organization.name}
            </span>
            <span className="mt-0.5 block truncate text-caption text-violet-200">
              {verified
                ? 'Payouts enabled'
                : pending
                  ? 'Verification with our team'
                  : 'Verification not started'}
            </span>
          </span>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full border px-2.5 py-1 text-caption font-bold uppercase tracking-wide',
            verified
              ? 'border-violet-400/40 bg-violet-500/25 text-violet-100'
              : 'border-butter-300/40 bg-butter-300/20 text-butter-100',
          )}
        >
          {verified ? 'Verified' : pending ? 'In review' : 'Unverified'}
        </span>
      </div>
    </Link>
  );
}

/**
 * The next pass, drawn as the object it is.
 *
 * `GET /me/tickets` returns the event TITLE, the tier name, the status and the
 * signed token — and no date, no venue and no poster. The reference's card
 * leads on "Tomorrow, 7:00 PM · Manpho Convention Center", and both halves of
 * that would be either a second request per row or a fabrication. So this shows
 * what the payload holds and sends you to the screen that renders the QR at a
 * size a scanner can read, rather than shrinking it into a summary where nobody
 * could use it.
 */
function PassSpotlight() {
  const tickets = useActiveTickets();
  const next = tickets.next;
  if (!next) return null;

  return (
    <section
      aria-label="Your next pass"
      className="relative overflow-hidden rounded-2xl border border-ink-800 bg-ink-950 p-4 shadow-md dark:border-ink-700"
    >
      <Sheen className="w-2/3 via-violet-400/10" />

      <div className="relative flex items-center justify-between gap-3">
        {/* `text-success-500`, NOT `text-success-subtle`. The semantic pair
            swaps between themes — the subtle tint is a pale mint in light and a
            near-black green in dark — so on a card that is dark in BOTH it read
            correctly on one theme and vanished on the other. The primitive stop
            does not move. */}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-success-500/30 bg-success-500/20 px-2.5 py-1 text-caption font-semibold text-success-500">
          <span aria-hidden className="settings-live-dot size-1.5 rounded-full bg-success-500" />
          Ready to use
        </span>
        <span className="min-w-0 truncate text-caption text-ink-400">{next.ticket_type_name}</span>
      </div>

      <div className="relative mt-3 space-y-1">
        <h3 className="text-body-sm font-bold leading-snug text-ink-25">{next.event_title}</h3>
        {next.attendee_name ? (
          <p className="flex items-center gap-1.5 text-caption text-ink-400">
            <UserRound className="size-3 shrink-0 text-violet-400" aria-hidden />
            <span className="min-w-0 truncate">Admits {next.attendee_name}</span>
          </p>
        ) : null}
      </div>

      <div className="relative mt-3 flex items-center justify-between gap-3 border-t border-ink-800 pt-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-ink-800 text-ink-50"
          >
            <QrCode className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-mono text-caption font-semibold text-ink-25">
              {reference(next.id)}
            </span>
            <span className="block text-caption text-ink-400">
              {tickets.active === 1
                ? '1 pass'
                : `${tickets.active}${tickets.more ? '+' : ''} passes`}
            </span>
          </span>
        </div>
        <Link
          href="/account/tickets"
          className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-ink-25 px-3 py-1.5 text-label text-ink-950 transition-colors duration-fast hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
        >
          View pass
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </section>
  );
}

/** The first segment of a ticket's uuid, upper-cased — what a support chat
 *  actually reads out. Not a new identifier: it is the id the row already has. */
function reference(id: string): string {
  return id.split('-')[0].toUpperCase();
}

/* -------------------------------------------------------------- the groups */

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-1 text-caption font-bold uppercase tracking-wider text-foreground-subtle">
      {children}
    </h2>
  );
}

function GroupCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}

/** The coloured tile every row leads with — the reference's one flash of hue
 *  per line, which is what stops eight identical rows reading as a wall. */
type TileTone = 'primary' | 'info' | 'warning' | 'success' | 'neutral' | 'nav';

const TILE: Record<TileTone, string> = {
  primary: 'bg-primary/10 text-primary',
  info: 'bg-info-subtle text-info-subtle-foreground',
  warning: 'bg-warning-subtle text-warning-subtle-foreground',
  success: 'bg-success-subtle text-success-subtle-foreground',
  neutral: 'bg-muted text-muted-foreground',
  nav: 'bg-nav-active text-nav-active-foreground',
};

function RowTile({ icon: Icon, tone }: { icon: LucideIcon; tone: TileTone }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-xl transition-transform duration-fast group-hover:scale-105 motion-reduce:transform-none motion-reduce:transition-none',
        TILE[tone],
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}

/**
 * A row that GOES somewhere.
 *
 * Two lines, and the second is not a restatement of the first: "Profile" names
 * the destination, "Name, phone and your email address" says whether it is the
 * one you want, which is the whole job of a settings list. Rows are
 * `min-h-control` (44px, the touch floor) and the WHOLE row is the target,
 * never just the text.
 */
function LinkRow({
  href,
  icon,
  tone,
  label,
  hint,
  trailing,
}: {
  href: string;
  icon: LucideIcon;
  tone: TileTone;
  label: string;
  hint: string;
  trailing?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-control items-center justify-between gap-3 px-card py-3.5 transition-colors duration-fast hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
    >
      <span className="flex min-w-0 items-center gap-3.5">
        <RowTile icon={icon} tone={tone} />
        <span className="min-w-0">
          <span className="block truncate text-body-sm font-semibold text-foreground">{label}</span>
          <span className="mt-0.5 block truncate text-caption text-muted-foreground">{hint}</span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {trailing}
        <ChevronRight
          aria-hidden
          className="size-4 text-foreground-subtle transition-transform duration-fast group-hover:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none"
        />
      </span>
    </Link>
  );
}

/** A row that carries its control instead of a destination. */
function ControlRow({
  icon,
  tone,
  label,
  hint,
  children,
  stacked = false,
}: {
  icon: LucideIcon;
  tone: TileTone;
  label: string;
  hint: string;
  children: React.ReactNode;
  /** Put the control on its own line — for the theme group, which cannot sit
   *  beside a label at 360px without dropping under its own touch target. */
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex min-h-control px-card py-3.5',
        stacked ? 'flex-col gap-3' : 'items-center justify-between gap-3',
      )}
    >
      <div className="flex min-w-0 items-center gap-3.5">
        <RowTile icon={icon} tone={tone} />
        <div className="min-w-0">
          <p className="text-body-sm font-semibold text-foreground">{label}</p>
          <p className="mt-0.5 text-caption text-muted-foreground">{hint}</p>
        </div>
      </div>
      <div className={cn('flex shrink-0 items-center gap-2', stacked && 'w-full')}>{children}</div>
    </div>
  );
}

/* -------------------------------------------------- 1 · account & security */

function AccountGroup() {
  const { user } = useAuth();
  const tickets = useActiveTickets();

  return (
    <section className="flex flex-col gap-2">
      <GroupHeading>Account &amp; security</GroupHeading>
      {/* A `nav`, labelled the same as the desktop rail: these rows are the
          phone's copy of that rail, so a screen reader hears one name for one
          job at both widths. */}
      <nav aria-label="Settings sections">
        <GroupCard>
          <LinkRow
            href={sectionHref('profile')}
            icon={UserRound}
            tone="primary"
            label="Profile"
            hint="Name, phone and email"
            trailing={
              user?.email_verified ? (
                <span className="rounded-full bg-success-subtle px-2 py-0.5 text-caption font-semibold text-success-subtle-foreground">
                  Verified
                </span>
              ) : (
                <span className="rounded-full bg-warning-subtle px-2 py-0.5 text-caption font-semibold text-warning-subtle-foreground">
                  Unverified
                </span>
              )
            }
          />
          <LinkRow
            href="/account/tickets"
            icon={TicketIcon}
            tone="info"
            label="Tickets and refunds"
            hint="Every pass this account holds"
            trailing={
              tickets.pending ? null : (
                <span className="text-caption text-muted-foreground">
                  {tickets.active}
                  {tickets.more ? '+' : ''} active
                </span>
              )
            }
          />
          <LinkRow
            href={sectionHref('account')}
            icon={KeyRound}
            tone="warning"
            label="Account"
            hint="Connected apps and signing out"
          />
        </GroupCard>
      </nav>
    </section>
  );
}

/* ------------------------------------------------------ 2 · app experience */

const THEMES: readonly { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

function ExperienceGroup() {
  return (
    <section className="flex flex-col gap-2">
      <GroupHeading>App experience</GroupHeading>
      <GroupCard>
        <ThemeRow />
        <ReminderRow />
        <nav aria-label="Privacy settings">
          <LinkRow
            href={sectionHref('privacy')}
            icon={ShieldCheck}
            tone="success"
            label="Privacy &amp; data"
            hint="Cookie choice and saved events"
          />
        </nav>
      </GroupCard>
    </section>
  );
}

/**
 * The theme, in place rather than behind a chevron.
 *
 * It is the most-pressed control on this page and it applies INSTANTLY — put it
 * one navigation away and the person changing it cannot see what they changed.
 * Three segments, not two: `system` is a real, distinct answer, and dropping it
 * would silently pin somebody who had chosen it.
 */
function ThemeRow() {
  const { theme, setTheme } = useTheme();

  return (
    <ControlRow icon={Moon} tone="neutral" label="Theme" hint="Light, dark or this device" stacked>
      <div
        role="radiogroup"
        aria-label="Colour theme"
        className="flex w-full gap-1 rounded-xl border border-border bg-sunken p-1"
      >
        {THEMES.map((option) => {
          const selected = option.value === theme;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setTheme(option.value)}
              className={cn(
                'inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-label transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
                selected
                  ? 'bg-surface text-foreground shadow-sm'
                  : 'font-medium text-muted-foreground hover:text-foreground',
              )}
            >
              <option.icon className="size-3.5" aria-hidden />
              {option.label}
            </button>
          );
        })}
      </div>
    </ControlRow>
  );
}

/**
 * Push reminders for THIS device — the one switch on the page, and it is real.
 *
 * `usePush` returns eight states rather than a boolean, and every state that is
 * not `on`/`off` means the switch CANNOT work: no VAPID keys on the deployment,
 * an insecure origin, a browser with no push, a permission the person blocked.
 * In each of those it is disabled and the hint says which one it is, because a
 * switch that silently refuses is indistinguishable from one that is broken.
 *
 * This is NOT the notification-preference toggle the reference has. Emails and
 * SMS carrying a ticket are always sent, there is no preference model behind
 * them, and a switch claiming otherwise would make somebody stop expecting the
 * message that holds their pass.
 */
function ReminderRow() {
  const { state, busy, error, enable, disable } = usePush();

  const hint: Record<typeof state, string> = {
    loading: 'Checking what is available here.',
    unavailable: 'Not configured on this deployment.',
    unsupported: 'This browser cannot receive them.',
    insecure: 'Needs a secure (https) connection.',
    'signed-out': 'A subscription belongs to an account.',
    blocked: 'Blocked in your browser settings.',
    off: 'One reminder the day before an event.',
    on: 'On for this account.',
  };

  const switchable = state === 'on' || state === 'off';

  return (
    <ControlRow
      icon={state === 'on' ? BellRing : Bell}
      tone="nav"
      label="Event reminders"
      hint={error ?? hint[state]}
    >
      <Switch
        checked={state === 'on'}
        disabled={!switchable || busy}
        aria-label="Event reminders on this device"
        onCheckedChange={(next) => void (next ? enable() : disable())}
      />
    </ControlRow>
  );
}

/* ------------------------------------------------------------- 3 · support */

function SupportGroup() {
  return (
    <section className="flex flex-col gap-2">
      <GroupHeading>Support</GroupHeading>
      <nav aria-label="Support">
        <GroupCard>
          <LinkRow
            href="/support"
            icon={Headset}
            tone="info"
            label="Contact support"
            hint="Booking, refund and entry questions"
          />
          <LinkRow
            href="/help"
            icon={LifeBuoy}
            tone="neutral"
            label="Help centre"
            hint="Entry rules, refunds and FAQs"
          />
        </GroupCard>
      </nav>
    </section>
  );
}

/* ----------------------------------------------------- 4 · session actions */

function SessionActions() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  return (
    <section className="flex flex-col items-center gap-3 pt-1">
      {/* Full width and quiet. Leaving is not this page's primary action, so it
          is an outlined pill with destructive INK rather than a destructive
          FILL — the loudest thing on a settings screen must not be the way
          out. */}
      <button
        type="button"
        onClick={() => void signOut().then(() => router.push('/'))}
        className="group inline-flex min-h-control w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface text-label text-destructive shadow-sm transition-colors duration-fast hover:border-destructive/30 hover:bg-destructive-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
      >
        <LogOut
          className="size-4 transition-transform duration-fast group-hover:-translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none"
          aria-hidden
        />
        Log out
      </button>
      <p className="max-w-full truncate text-caption text-foreground-subtle">
        Signed in as {user?.email}
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------- data */

type MeTicket = {
  id: string;
  event_title: string;
  ticket_type_name: string;
  status: 'active' | 'used' | 'void';
  attendee_name?: string;
};

/**
 * The first page of `/me/tickets`, shared by the hero, the pass card and the
 * tickets row.
 *
 * ONE query key for all three, so they are one request rather than three — and
 * the same key the account overview already uses, so arriving here from that
 * page shows the numbers immediately instead of re-fetching what is cached.
 *
 * `active` is a FLOOR, not a total: a cursor-paginated list has no count, and
 * `more` is what lets a caller render `12+` rather than a number that quietly
 * means "12 of however many".
 */
function useActiveTickets() {
  const { status } = useAuth();
  const query = useQuery({
    queryKey: ['account', 'tickets', 'first-page'],
    queryFn: () => api.get<Paginated<MeTicket>>('/me/tickets'),
    enabled: status === 'authenticated',
    staleTime: 30_000,
  });

  const rows = query.data?.data ?? [];
  const live = rows.filter((ticket) => ticket.status === 'active');

  return {
    pending: query.isPending,
    active: live.length,
    more: Boolean(query.data?.meta.next),
    next: live[0] ?? null,
  };
}
