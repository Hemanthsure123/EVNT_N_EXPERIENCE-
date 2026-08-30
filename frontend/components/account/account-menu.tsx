'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Building2,
  Check,
  ChevronRight,
  ChevronsUpDown,
  CircleHelp,
  FileText,
  Info,
  LifeBuoy,
  LogOut,
  Plus,
  Settings,
  ShieldCheck,
  Ticket,
  User as UserIcon,
} from 'lucide-react';
import { Drawer, DrawerClose, DrawerContent, DrawerTrigger } from '@/components/ui/drawer';
import { IdentityAvatar } from '@/components/ui/avatar';
import { avatarUrlOf, resolveMediaUrl } from '@/lib/api/profile';
import { useAuth } from '@/lib/auth/auth-provider';
import { useScope } from '@/lib/identity/scope';
import { cn } from '@/lib/utils/cn';

/**
 * The account menu — District by Zomato style right-side drawer profile experience.
 */
export function AccountMenu() {
  const { user, signOut } = useAuth();
  const { isAdmin, isOrganizer, organizations, active, switchTo, ready } = useScope();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  const name = user?.full_name || user?.email || 'Your account';
  const label =
    active.kind === 'organization' ? active.organization.name : user?.full_name || 'Personal';

  const avatarUrl = avatarUrlOf(user);
  const triggerImageUrl =
    active.kind === 'organization' ? resolveMediaUrl(active.organization.logo_url) : avatarUrl;

  const close = () => setOpen(false);

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger
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
        <span className="hidden max-w-28 truncate text-label lg:inline">{label}</span>
        <ChevronsUpDown
          className="hidden size-3.5 shrink-0 text-muted-foreground lg:block"
          aria-hidden
        />
      </DrawerTrigger>

      <DrawerContent side="right" bare className="w-full max-w-md bg-muted/40 border-l shadow-2xl flex flex-col h-full">
        {/* District Top Header Bar */}
        <div className="flex items-center gap-3 border-b border-border bg-surface px-5 py-4 shrink-0">
          <DrawerClose className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <ArrowLeft className="size-5" aria-hidden />
          </DrawerClose>
          <h2 className="text-body-lg font-bold text-foreground">Profile</h2>
        </div>

        {/* Scrollable Drawer Body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
          {/* User Info Header Block */}
          <div className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-4 shadow-sm">
            <IdentityAvatar name={name} imageUrl={avatarUrl} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body-lg font-bold text-foreground">{name}</p>
              <p className="truncate text-caption text-muted-foreground">{user?.email}</p>
              {isAdmin ? (
                <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-caption font-medium text-foreground">
                  <ShieldCheck className="size-3.5 text-muted-foreground" aria-hidden />
                  Platform operator
                </span>
              ) : null}
            </div>
          </div>

          {/* Bookings Card */}
          <div className="rounded-2xl border border-border bg-surface p-1.5 shadow-sm">
            <MenuLink href="/account/tickets" icon={Ticket} onNavigate={close}>
              View all bookings
            </MenuLink>
          </div>

          {/* Scope Switcher (if organizer / staff) */}
          {ready && (isOrganizer || isAdmin) ? (
            <div className="flex flex-col gap-2">
              <GroupLabel>Account Scope</GroupLabel>
              <div className="flex flex-col gap-1.5 rounded-2xl border border-border bg-surface p-1.5 shadow-sm">
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
            </div>
          ) : null}

          {/* Support Section */}
          <div className="flex flex-col gap-2">
            <GroupLabel>Support</GroupLabel>
            <div className="flex flex-col gap-1.5 rounded-2xl border border-border bg-surface p-1.5 shadow-sm">
              <MenuLink href="/support" icon={LifeBuoy} onNavigate={close}>
                Chat with us
              </MenuLink>
              <MenuLink href="/help" icon={CircleHelp} onNavigate={close}>
                Help centre
              </MenuLink>
            </div>
          </div>

          {/* More Section */}
          <div className="flex flex-col gap-2">
            <GroupLabel>More</GroupLabel>
            <div className="flex flex-col gap-1.5 rounded-2xl border border-border bg-surface p-1.5 shadow-sm divide-y divide-border/40">
              <MenuLink href="/terms" icon={CircleHelp} onNavigate={close}>
                Terms & Conditions
              </MenuLink>
              <MenuLink href="/privacy" icon={FileText} onNavigate={close}>
                Privacy Policy
              </MenuLink>
              <MenuLink href="/account/settings" icon={Settings} onNavigate={close}>
                Settings
              </MenuLink>
              <MenuLink href="/about" icon={Info} onNavigate={close}>
                About us
              </MenuLink>
            </div>
          </div>

          {/* Logout Card */}
          <div className="rounded-2xl border border-border bg-surface p-1.5 shadow-sm">
            <button
              type="button"
              onClick={() => {
                close();
                void signOut().then(() => router.push('/'));
              }}
              className={rowClass}
            >
              <LogOut className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">Logout</span>
            </button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

const rowClass = cn(
  'flex min-h-12 w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-body-sm',
  'transition-colors duration-fast hover:bg-muted/60',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
);

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      aria-hidden
      className="px-2 pt-1 text-caption font-semibold text-muted-foreground"
    >
      {children}
    </div>
  );
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
          : 'text-foreground hover:bg-muted/60',
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
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{children}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
    </Link>
  );
}

export { Plus };
