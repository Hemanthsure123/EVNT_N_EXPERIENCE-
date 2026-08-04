'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Check,
  ChevronsUpDown,
  LayoutDashboard,
  LogOut,
  Music4,
  Plus,
  Settings,
  ShieldCheck,
  Ticket,
  User as UserIcon,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { IdentityAvatar } from '@/components/ui/avatar';
import { avatarUrlOf, resolveMediaUrl } from '@/lib/api/profile';
import { useAuth } from '@/lib/auth/auth-provider';
import { useScope } from '@/lib/identity/scope';
import { cn } from '@/lib/utils/cn';

/**
 * The account menu — one identity, many scopes.
 *
 * ── STRUCTURE (Shopify's, and it earns its shape) ─────────────────────────
 *
 *   identity card      who you are, and whether you are verified
 *   ──────────────
 *   SWITCH TO          personal · each organization · Console (staff)
 *   ──────────────
 *   destinations       scoped to the ACTIVE hat, not to everything you own
 *   ──────────────
 *   account            settings · support · sign out
 *
 * The switcher sits ABOVE the destinations deliberately. "Which account am I
 * in" has to be answered before "where am I going" — an organizer who publishes
 * to the wrong organization was, almost always, looking at the right menu in
 * the wrong scope.
 *
 * ── SWITCHING NEVER RE-AUTHENTICATES ──────────────────────────────────────
 *
 * There is one token and one session. Switching changes a local preference and
 * the navigation it drives; it does not touch auth. See `lib/identity/scope`.
 *
 * ── NOTHING HERE IS A ROLE CLAIM THE SERVER HAS NOT MADE ──────────────────
 *
 * Organizations come from `GET /organizations/` (exactly what this person
 * owns) and Console from `is_staff` on `/auth/me`. The menu is a projection of
 * server truth. Every one of these routes is enforced server-side too — this
 * only decides what is worth offering.
 *
 * ── COLOUR: NOTHING HERE IS AN ACTION, SO NOTHING HERE IS THE CTA ─────────
 *
 * The menu is entirely navigation and state, so it carries none of the
 * near-black `--cta` fill. The active scope wears the warm `--nav-active`
 * pill — the same "you are here" token the account rail and the site nav use —
 * and the personal avatar is a cream medallion rather than the old violet→pink
 * gradient. The organisation avatar stays a neutral ROUNDED TILE against the
 * personal CIRCLE, so the two are still told apart by shape and not only by
 * label.
 *
 * The medallion itself is `IdentityAvatar` from the design system rather than a
 * local `<span>`, so a picture uploaded on the account page appears HERE and in
 * the header on the same render. It used to be a private component in this file,
 * which is how one surface keeps showing initials after an upload — and the
 * header trigger is the surface somebody checks to confirm the upload worked.
 *
 * Rows are `min-h-control` (44px) because this menu is opened by thumb on a
 * phone as often as by cursor.
 *
 * Design system: §11.9 menu semantics, §12.4 role switching, §14.2 keyboard.
 */
export function AccountMenu() {
  const { user, signOut } = useAuth();
  const { isAdmin, isOrganizer, organizations, active, switchTo, ready } = useScope();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  const name = user?.full_name || user?.email || 'Your account';
  const label =
    active.kind === 'organization' ? active.organization.name : user?.full_name || 'Personal';

  // The picture, or `''` for "fall back to initials". Read from `useAuth().user`
  // — the same cached profile `applyProfile` replaces after an upload — so this
  // has no second source of truth for who is signed in.
  const avatarUrl = avatarUrlOf(user);
  // In organisation scope the trigger is showing the ORGANISATION, so it shows
  // that organisation's logo (a real column, `Organization.logo_url`) and never
  // the owner's face — borrowing it would misidentify the active scope, which is
  // the one failure this menu exists to prevent.
  const triggerImageUrl =
    active.kind === 'organization' ? resolveMediaUrl(active.organization.logo_url) : avatarUrl;

  const close = () => setOpen(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Account menu — currently ${label}`}
        className={cn(
          'inline-flex h-control shrink-0 items-center gap-2 rounded-full border border-border bg-surface pl-1.5 pr-2.5',
          'transition-colors duration-fast ease-out hover:border-foreground/20 hover:bg-muted',
          'active:scale-95 motion-reduce:active:scale-100',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        )}
      >
        <IdentityAvatar
          name={label}
          imageUrl={triggerImageUrl}
          size="sm"
          shape={active.kind === 'organization' ? 'tile' : 'circle'}
        />
        {/* The active scope is on the TRIGGER, not just inside the menu — the
            whole failure mode is acting in the wrong organization without
            having opened anything. */}
        <span className="hidden max-w-28 truncate text-label lg:inline">{label}</span>
        <ChevronsUpDown
          className="hidden size-3.5 shrink-0 text-muted-foreground lg:block"
          aria-hidden
        />
      </PopoverTrigger>

      <PopoverContent align="end" className="w-72 p-1.5">
        <div className="flex items-center gap-3 px-2.5 pb-2.5 pt-2">
          {/* The identity card is always the PERSON, whatever scope is active —
              it answers "who am I signed in as", which the scope cannot change. */}
          <IdentityAvatar name={name} imageUrl={avatarUrl} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body-sm font-semibold">{name}</p>
            <p className="truncate text-caption text-foreground-subtle">{user?.email}</p>
          </div>
        </div>

        {/* Verification is shown ONLY when the server says so. There is no
            email-verification endpoint yet, so an "unverified" pill here would
            be a claim about a check nobody runs. Staff is a real flag. */}
        {isAdmin ? (
          <p className="mx-2.5 mb-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-caption font-medium text-secondary-foreground">
            <ShieldCheck className="size-3" aria-hidden />
            Platform operator
          </p>
        ) : null}

        {ready && (isOrganizer || isAdmin) ? (
          <>
            <Divider />
            <p className="px-2.5 pb-1 pt-2 text-caption font-semibold uppercase tracking-wide text-foreground-subtle">
              Switch to
            </p>
            <ScopeRow
              active={active.kind === 'personal'}
              icon={<UserIcon className="size-4" aria-hidden />}
              label="Personal account"
              hint="Your tickets and orders"
              onSelect={() => {
                switchTo({ kind: 'personal' });
                close();
                router.push('/account');
              }}
            />
            {organizations.map((organization) => (
              <ScopeRow
                key={organization.id}
                active={
                  active.kind === 'organization' && active.organization.id === organization.id
                }
                icon={<Building2 className="size-4" aria-hidden />}
                label={organization.name}
                hint={
                  organization.verified_level === 'verified' ? 'Verified organiser' : 'Organiser'
                }
                onSelect={() => {
                  switchTo({ kind: 'organization', organization });
                  close();
                  router.push('/dashboard');
                }}
              />
            ))}
          </>
        ) : null}

        <Divider />

        {/* Destinations follow the ACTIVE scope. An organizer in personal
            scope still gets one way back — hiding it entirely would strand
            them — but the dashboard is not the headline when they are
            wearing the attendee hat. */}
        <MenuLink href="/account" icon={UserIcon} onNavigate={close}>
          Profile
        </MenuLink>
        <MenuLink href="/account/tickets" icon={Ticket} onNavigate={close}>
          My tickets
        </MenuLink>
        {isOrganizer ? (
          <MenuLink href="/dashboard" icon={LayoutDashboard} onNavigate={close}>
            Organizer dashboard
          </MenuLink>
        ) : (
          // The inverse of the row above, and the ONLY route to becoming an
          // organizer. Shown to people who are not one precisely because they
          // are its audience — gating it on already having an organization
          // would hide the door behind itself.
          <MenuLink href="/account/organizer" icon={Building2} onNavigate={close}>
            Host events
          </MenuLink>
        )}
        {/* Gated on owning an organisation, which is the prerequisite for an
            act — not on owning an act, because fetching every signed-in
            visitor's performer list on every page to decide whether to draw one
            menu row is a request nobody asked for. Somebody with an
            organisation and no acts lands on the page that explains what a
            listing is, which is the right destination for them anyway. */}
        {isOrganizer ? (
          <MenuLink href="/studio" icon={Music4} onNavigate={close}>
            Performer studio
          </MenuLink>
        ) : null}
        {isAdmin ? (
          <MenuLink href="/admin" icon={ShieldCheck} onNavigate={close}>
            Operator console
          </MenuLink>
        ) : null}

        <Divider />

        {/* Settings is the appearance + account page; a dedicated support
            surface does not exist yet, so no entry points at one. §12.3. */}
        <MenuLink href="/account/settings" icon={Settings} onNavigate={close}>
          Settings
        </MenuLink>
        <button
          type="button"
          onClick={() => {
            close();
            void signOut().then(() => router.push('/'));
          }}
          className={rowClass}
        >
          <LogOut className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          Sign out
        </button>
      </PopoverContent>
    </Popover>
  );
}

// `min-h-control` (44px) rather than padding alone: this menu is a thumb
// target on a phone as often as a cursor target on a desktop.
const rowClass = cn(
  'flex min-h-control w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-body-sm',
  'transition-colors duration-fast hover:bg-muted',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
);

// `border-strong`, not `border`: this rule has to actually separate two groups
// of rows, and a 1.27:1 hairline on a white popover reads as nothing.
function Divider() {
  return <div className="my-1.5 h-px bg-border-strong" role="separator" />;
}

function ScopeRow({
  active,
  icon,
  label,
  hint,
  onSelect,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  hint: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      // `menuitemradio` is the honest role: these are mutually exclusive
      // scopes, and a screen reader should announce which one is current.
      role="menuitemradio"
      aria-checked={active}
      // The warm "you are here" pill, not the near-black CTA fill — switching
      // scope is state, and a black row here would compete with the one real
      // action a screen is allowed to have.
      className={cn(
        rowClass,
        active && 'bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover',
      )}
    >
      <span className={cn('shrink-0', active ? 'text-nav-active-foreground' : 'text-muted-foreground')}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        <span
          className={cn(
            'block truncate text-caption',
            active ? 'text-nav-active-foreground/75' : 'text-foreground-subtle',
          )}
        >
          {hint}
        </span>
      </span>
      {active ? <Check className="size-4 shrink-0 text-nav-active-foreground" aria-hidden /> : null}
    </button>
  );
}

function MenuLink({
  href,
  icon: Icon,
  onNavigate,
  children,
}: {
  href: string;
  icon: typeof Ticket;
  onNavigate: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} onClick={onNavigate} className={rowClass}>
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      {children}
    </Link>
  );
}

// The medallion that used to live here is `IdentityAvatar` in
// `components/ui/avatar` now — it moved because it also has to render a PICTURE,
// and a second copy of "circle for a person, tile for an organisation" is how
// the header ends up showing initials for somebody who has an avatar. The shape
// language it carried (a warm cream circle vs a neutral rounded tile) is
// unchanged; only its address is.

export { Plus };
