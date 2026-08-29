'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Check,
  ChevronRight,
  ChevronsUpDown,
  CircleHelp,
  FileText,
  Info,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
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

      <PopoverContent align="end" className="w-80 p-3.5 flex flex-col gap-2 rounded-2xl shadow-xl border border-border bg-surface">
        <div className="flex items-center gap-3 px-2 py-1">
          {/* The identity card is always the PERSON, whatever scope is active */}
          <IdentityAvatar name={name} imageUrl={avatarUrl} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body-sm font-bold text-foreground">{name}</p>
            <p className="truncate text-caption text-muted-foreground">{user?.email}</p>
          </div>
        </div>

        {isAdmin ? (
          <div className="px-2 pb-1">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-caption font-medium text-foreground">
              <ShieldCheck className="size-3.5 text-muted-foreground" aria-hidden />
              Platform operator
            </span>
          </div>
        ) : null}

        {ready && (isOrganizer || isAdmin) ? (
          <>
            <Divider />
            <GroupLabel>SWITCH TO</GroupLabel>
            <div className="flex flex-col gap-1.5">
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
            </div>
          </>
        ) : null}

        <Divider />

        <div className="flex flex-col gap-1.5">
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
            <MenuLink href="/account/organizer" icon={Building2} onNavigate={close}>
              Host events
            </MenuLink>
          )}
          {isAdmin ? (
            <MenuLink href="/admin" icon={ShieldCheck} onNavigate={close}>
              Operator console
            </MenuLink>
          ) : null}
        </div>

        <Divider />

        <GroupLabel>SUPPORT</GroupLabel>
        <div className="flex flex-col gap-1.5">
          <MenuLink href="/help" icon={CircleHelp} onNavigate={close}>
            Help centre
          </MenuLink>
          <MenuLink href="/support" icon={LifeBuoy} onNavigate={close}>
            Contact support
          </MenuLink>
        </div>

        <Divider />

        <GroupLabel>MORE</GroupLabel>
        <div className="flex flex-col gap-1.5">
          <MenuLink href="/account/settings" icon={Settings} onNavigate={close}>
            Settings
          </MenuLink>
          <MenuLink href="/terms" icon={FileText} onNavigate={close}>
            Terms & conditions
          </MenuLink>
          <MenuLink href="/about" icon={Info} onNavigate={close}>
            About us
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
            <span className="min-w-0 flex-1 truncate font-medium">Sign out</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const rowClass = cn(
  'flex min-h-12 w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left text-body-sm',
  'bg-muted/40 transition-colors duration-fast hover:bg-muted/80',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
);

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      aria-hidden
      className="px-2 pb-1 pt-1 text-caption font-bold uppercase tracking-wider text-muted-foreground"
    >
      {children}
    </div>
  );
}

function Divider() {
  return <div className="my-1 h-px bg-border/60" role="separator" />;
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
      role="menuitemradio"
      aria-checked={active}
      className={cn(
        rowClass,
        active
          ? 'border border-border-strong bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
          : 'bg-muted/40 text-foreground hover:bg-muted/80',
      )}
    >
      <span className={cn('shrink-0', active ? 'text-nav-active-foreground' : 'text-muted-foreground')}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold text-body-sm">{label}</span>
        <span
          className={cn(
            'block truncate text-caption',
            active ? 'text-nav-active-foreground/80' : 'text-muted-foreground',
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
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate font-medium">{children}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
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
