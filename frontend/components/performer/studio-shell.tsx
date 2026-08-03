'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  CalendarDays,
  Eye,
  Images,
  Inbox,
  KanbanSquare,
  Loader2,
  Music4,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-provider';
import { PERFORMER_TYPE_LABELS } from '@/lib/api/performers';
import { profileState, useAct, useMyActs, usePipeline } from '@/lib/performer/studio';
import { StatusPill } from '@/components/organizer/primitives';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

/**
 * The Performer Studio's frame.
 *
 * ── IT IS SCOPED TO ONE ACT, NOT TO AN ACCOUNT ────────────────────────────
 *
 * An organisation may list several acts — a DJ and a live band under one
 * roof — and almost nothing in this workspace makes sense across them. Leads
 * are matched per act, quotes belong to an act, and a profile IS an act. So
 * the act id is in the URL and the switcher changes it, rather than the studio
 * showing a merged view nobody could act on.
 *
 * ── THE NAV CARRIES THE ONE COUNT THAT MEANS SOMETHING ────────────────────
 *
 * New leads, on the Leads item, and nothing else. A badge on four sections at
 * once is a badge nobody reads; a badge that counts things needing no action
 * never reaches zero, and people learn to ignore it.
 *
 * ── "YOU ARE HERE" IS THE BUTTER PILL, NOT THE BRAND VIOLET ───────────────
 *
 * The active section uses `--nav-active` (warm butter in light, deep warm
 * brown in dark) rather than `--secondary`, which is the shared neutral tint
 * a hundred other things already use — a wayfinding state has to be the ONE
 * thing on the page wearing that colour or it stops answering "where am I".
 * The violet accent survives on the lead count, which is a marker, not an
 * action; `--cta` is reserved for the single primary button on a screen.
 *
 * Same tokens, same density and same shell language as the organizer
 * dashboard — a performer who also runs events should not have to learn a
 * second product.
 */

type Section = { href: string; label: string; icon: LucideIcon; hint: string };

function sectionsFor(id: string): Section[] {
  return [
    { href: `/studio/${id}`, label: 'Overview', icon: Music4, hint: 'What needs you today' },
    { href: `/studio/${id}/leads`, label: 'Leads', icon: Inbox, hint: 'Briefs you can answer' },
    {
      href: `/studio/${id}/pipeline`,
      label: 'Pipeline',
      icon: KanbanSquare,
      hint: 'Every enquiry, from lead to played',
    },
    {
      href: `/studio/${id}/calendar`,
      label: 'Calendar',
      icon: CalendarDays,
      hint: 'Confirmed dates and enquiries',
    },
    { href: `/studio/${id}/profile`, label: 'Profile', icon: UserCog, hint: 'How you appear' },
    { href: `/studio/${id}/photos`, label: 'Photos', icon: Images, hint: 'Your gallery' },
    {
      href: `/studio/${id}/analytics`,
      label: 'Analytics',
      icon: BarChart3,
      hint: 'Quotes, wins and booked value',
    },
    { href: `/studio/${id}/preview`, label: 'Preview', icon: Eye, hint: 'Exactly what a customer sees' },
  ];
}

export function StudioShell({
  performerId,
  children,
}: {
  performerId: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? '';
  const { status } = useAuth();
  const act = useAct(performerId);
  const { pipeline } = usePipeline(performerId);

  if (status === 'unknown') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="inline-flex items-center gap-2 text-body-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Checking your access…
        </p>
      </div>
    );
  }

  if (status === 'anonymous') {
    return (
      <div className="flex min-h-dvh items-center justify-center p-card-lg">
        <div className="flex max-w-md flex-col gap-stack-lg text-center">
          <h1 className="text-h3">Sign in to your studio</h1>
          <p className="text-body-sm text-muted-foreground">
            This is where you manage your profile, your leads and your bookings, so it needs to
            know who you are.
          </p>
          <Button asChild className="mx-auto w-fit">
            <Link href={`/sign-in?next=${encodeURIComponent(pathname)}`}>Sign in</Link>
          </Button>
        </div>
      </div>
    );
  }

  const sections = sectionsFor(performerId);

  return (
    <div className="mx-auto flex w-full max-w-dashboard flex-col gap-block px-4 py-block lg:flex-row lg:gap-block-lg lg:px-8 lg:py-block-lg">
      <aside className="lg:w-56 lg:shrink-0">
        <div className="lg:sticky lg:top-sticky-top-lg lg:flex lg:flex-col lg:gap-block">
          <ActSwitcher currentId={performerId} />

          <nav aria-label="Studio sections">
            <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
              {sections.map((section) => {
                // Exact match for the overview, prefix for the rest — otherwise
                // Overview stays lit on every child route.
                const active =
                  section.href === `/studio/${performerId}`
                    ? pathname === section.href
                    : pathname.startsWith(section.href);
                const badge = section.label === 'Leads' ? pipeline.leads.length : 0;

                return (
                  <li key={section.href} className="shrink-0 lg:shrink">
                    <Link
                      href={section.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        // 44px on a phone (the tap-target floor, and this row
                        // scrolls horizontally there); 36px in the desktop
                        // sidebar, where eight items should stay compact.
                        'flex h-control items-center gap-2.5 rounded-full px-3 text-label transition-colors duration-fast lg:h-control-sm',
                        'motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        active
                          ? 'bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <section.icon
                        className={cn('size-4 shrink-0', active && 'text-primary')}
                        aria-hidden
                      />
                      <span className="truncate">{section.label}</span>
                      {badge > 0 ? (
                        <span
                          className="ml-auto inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-caption tabular-nums text-primary-foreground"
                          aria-label={`${badge} new lead${badge === 1 ? '' : 's'}`}
                        >
                          {badge}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {act.data ? <StatusCard act={act.data} /> : null}
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

/**
 * The act switcher.
 *
 * A plain list rather than a dropdown when there are few acts — most
 * performers have one, and a menu to choose between one thing is chrome. It
 * only becomes a `<select>` past three.
 */
function ActSwitcher({ currentId }: { currentId: string }) {
  const query = useMyActs();
  const acts = query.data?.pages.flatMap((page) => page.data) ?? [];
  const current = acts.find((act) => act.id === currentId);

  if (query.isPending) {
    return <div className="skeleton h-16 w-full rounded-xl" aria-hidden />;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-xl border border-border bg-surface p-card shadow-sm">
        <p className="truncate text-body-sm font-semibold">
          {current?.stage_name ?? 'This act'}
        </p>
        <p className="truncate text-caption text-muted-foreground">
          {current ? PERFORMER_TYPE_LABELS[current.performer_type] : ''}
          {current?.city ? ` · ${current.city}` : ''}
        </p>
      </div>

      {acts.length > 1 ? (
        <ul className="flex flex-col gap-0.5">
          {acts
            .filter((act) => act.id !== currentId)
            .map((act) => (
              <li key={act.id}>
                <Link
                  href={`/studio/${act.id}`}
                  className="flex h-control items-center gap-2 rounded-full px-3 text-caption text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-control-sm"
                >
                  <Music4 className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{act.stage_name}</span>
                </Link>
              </li>
            ))}
        </ul>
      ) : null}

      <Link
        href="/studio"
        className="inline-flex h-control w-fit items-center rounded-full px-3 text-caption text-primary underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-control-sm"
      >
        All your acts
      </Link>
    </div>
  );
}

/** Where this profile stands, in the owner's own words rather than an enum. */
function StatusCard({ act }: { act: Parameters<typeof profileState>[0] }) {
  const state = profileState(act);
  return (
    <div className="hidden flex-col gap-2 rounded-xl border border-border bg-surface p-card shadow-sm lg:flex">
      <StatusPill tone={state.tone}>{state.label}</StatusPill>
      <p className="text-caption text-muted-foreground">{state.detail}</p>
    </div>
  );
}
