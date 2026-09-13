'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Loader2, LogOut, Ticket } from 'lucide-react';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-provider';
import { useScope } from '@/lib/identity/scope';
import { ORGANIZER_SECTIONS, isSectionActive } from '@/lib/organizer/nav';
import { useSidebar } from '@/lib/organizer/use-sidebar';
import {
  OrganizerFooterNav,
  ORGANIZER_NAV_CLEARANCE,
} from '@/components/organizer/organizer-footer-nav';
import { BrandLockup, BrandMark } from '@/components/shell/brand-mark';
import { SceneWelcome } from '@/components/illustrations/onboarding-scenes';
import { SpotListing } from '@/components/illustrations/spots';
import { cn } from '@/lib/utils/cn';
import { NotificationBell } from './notification-bell';
import { OrganizerPalette } from './command-palette';

/**
 * The organizer dashboard's frame: sidebar, top bar, and the guard around both.
 *
 * SAME TOKENS AS THE REST OF THE PLATFORM. An organizer console with its own
 * palette is a second product to maintain, and these are the people most
 * likely to move between the attendee site and here in one session. So the
 * near-black `--cta` pill, the warm `--nav-active` "you are here" fill and the
 * violet `--primary` accent mean exactly what they mean on the attendee site.
 *
 * ── THIS IS A WORKING SCREEN, NOT A LANDING PAGE ──────────────────────────
 *
 * DENSITY IS THE POINT. Sidebar rows are 36px on a desktop, the top bar is
 * 56px, content padding is one `--space-card` rung. The brief asked for
 * information density over decoration, and the way you get it is by not
 * spending 96px of vertical space on a heading that says "Dashboard" above a
 * breadcrumb that already said so.
 *
 * DENSITY IS NOT AN EXCUSE FOR A 32px TAP TARGET, though. Every control here
 * is `h-control` (44px) on a phone and only condenses to `h-control-sm` at
 * `lg`, where the pointer is a mouse — the drawer is thumb-operated at the
 * gate, and a check-in queue is the worst possible place to miss a button.
 *
 * ── ONE FILLED ACTION IN THE BAR ──────────────────────────────────────────
 *
 * "Create event" is the near-black `--cta` pill and it is the ONLY filled
 * control in the chrome. Search is an outline pill, the drawer/collapse/theme
 * controls are ghosts, the avatar is a quiet neutral medallion. A toolbar with
 * three filled buttons has no primary action, it has three equal ones.
 *
 * THE GUARD IS UX, NOT SECURITY. Every `/organizer/*` endpoint scopes its rows
 * to the caller server-side, and a signed-out request gets a 401 regardless.
 * This only decides what to render while the browser waits, and spares a
 * signed-out visitor a screenful of failing widgets.
 */
/**
 * Routes that lay themselves out.
 *
 * `/dashboard/home` is the attendee landing page rendered inside the
 * organizer shell — it is built from `Section`/`Container`, which already own
 * the gutter and the max width, so the shell must not add a second set.
 */
const FULL_BLEED_ROUTES = new Set(['/dashboard/home']);

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/dashboard';
  const { status } = useAuth();
  const { isOrganizer, hasOrganization, ready: scopeReady } = useScope();
  const { collapsed, ready, toggle } = useSidebar();
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  // A drawer that stays open over the page you just asked for is the most
  // common mobile dashboard annoyance.

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (status === 'unknown' || (status === 'authenticated' && !scopeReady)) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="inline-flex items-center gap-2 text-body-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Checking your access…
        </p>
      </div>
    );
  }

  if (status === 'anonymous') return <SignedOut />;

  // THE APPROVAL GATE.
  //
  // Being signed in was previously enough to open this shell, so anyone with
  // an account could reach the organizer dashboard — and anyone who had merely
  // typed an organization name got the full navigation. Every write behind it
  // is enforced server-side, so nothing could be DONE, but the product offered
  // a room full of doors that answer 403.
  //
  // `ready` matters: the organization list resolves after auth, and treating
  // "not loaded yet" as "not approved" would flash this panel at every real
  // organizer on every page load.
  if (scopeReady && !isOrganizer) return <AwaitingApproval hasOrganization={hasOrganization} />;

  // The dashboard's own chrome is right for tables and forms and wrong for a
  // page that is itself a layout. One route qualifies today; the set is named
  // rather than inlined so the next one is a line here instead of a condition
  // grown inside the JSX.
  const bleed = FULL_BLEED_ROUTES.has(pathname);

  return (
    <div className="flex min-h-dvh bg-background">
      <Sidebar
        collapsed={collapsed}
        ready={ready}
        onToggle={toggle}
        pathname={pathname}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* No props: the bar is the brand, the bell and the account menu. The
            palette is still opened by ⌘K, which the shell listens for above. */}
        <TopBar />
        {/* Capped at 1600px and centred — a table stretched across an
            ultrawide is unreadable, not impressive.

            ── EXCEPT WHERE THE PAGE BRINGS ITS OWN WIDTH ──────────────────
            The landing page is built from `Section`/`Container`, which set
            their own gutter and their own max width. Nesting it inside this
            one gives it two of each: a hero that should be full-bleed sits
            inset by 24px inside a 1600px column inside the viewport, and every
            rail below it is gutter-on-gutter. Those routes get a bare `main`
            and lay themselves out. */}
        <main
          id="organizer-main"
          className={cn(
            'min-w-0 flex-1',
            bleed ? null : 'p-card lg:p-card-lg',
            ORGANIZER_NAV_CLEARANCE,
          )}
        >
          {bleed ? children : <div className="mx-auto w-full max-w-dashboard">{children}</div>}
        </main>
      </div>

      <OrganizerFooterNav />

      <OrganizerPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

function Sidebar({
  collapsed,
  ready,
  onToggle,
  pathname,
}: {
  collapsed: boolean;
  ready: boolean;
  onToggle: () => void;
  pathname: string;
}) {
  return (
    <>
      {/* No scrim: there is no drawer to dim the page behind any more. */}
      <aside
        aria-label="Dashboard sections"
        className={cn(
          // `hidden lg:flex`, not an off-canvas panel that slides. Below `lg`
          // the sidebar does not exist at all — the footer bar is the
          // navigation — so there is nothing to translate off screen and
          // nothing a stray swipe can drag back on.
          'hidden border-r border-border bg-surface',
          'lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col',
          // Width is the only animated property, and only once the stored
          // state has been read — otherwise every load plays a collapse.
          ready &&
            'transition-[width,transform] duration-base ease-out motion-reduce:transition-none',
          collapsed ? 'w-sidebar lg:w-sidebar-collapsed' : 'w-sidebar',
        )}
      >
        {/* Same 56px as the top bar, so the brand and the breadcrumb sit on
            one line across the fold rather than half a rung apart. */}
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
          <Link
            href="/dashboard"
            className="flex min-w-0 items-center gap-2 rounded-full px-1 py-1 font-display text-body-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {/* THE product mark, not a stand-in.

                Both console shells drew a lucide `Ticket` glyph here while the
                public site drew the CX monogram — so the same product had two
                different logos depending on which half of it you were in, and
                an organizer moving between the site and their dashboard saw the
                brand change under them. `BrandMark` is the one definition
                (`components/shell/brand-mark.tsx`); it inherits `currentColor`,
                so it takes the sidebar's ink without a second asset. */}
            {collapsed ? (
              <BrandMark title="Curatix" className="h-6 w-auto" />
            ) : (
              <BrandLockup />
            )}
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          <ul className="flex flex-col gap-0.5">
            {ORGANIZER_SECTIONS.map((section) => {
              const active = isSectionActive(pathname, section.href);
              return (
                <li key={section.href}>
                  <Link
                    href={section.href}
                    aria-current={active ? 'page' : undefined}
                    title={collapsed ? section.label : undefined}
                    className={cn(
                      // 44px in the phone drawer, 36px once there is a mouse.
                      'flex h-control items-center gap-3 rounded-full px-2.5 text-label transition-colors duration-fast lg:h-control-sm',
                      'motion-reduce:transition-none',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active
                        ? // The warm butter pill: "you are here" is STATE, and
                          // wearing the near-black CTA fill would put ten
                          // primary actions in a rail.
                          'bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      collapsed && 'lg:justify-center lg:px-0',
                    )}
                  >
                    <section.icon className="size-4 shrink-0" aria-hidden />
                    <span className={cn('truncate', collapsed && 'lg:sr-only')}>
                      {section.label}
                    </span>
                    {/* CRITICAL items only, and only on Dashboard. A badge on
                        five sections at once is a badge nobody reads, and one
                        that counts "for information" items would never reach
                        zero — which is how people learn to ignore it. */}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex shrink-0 flex-col gap-1 border-t border-border p-2">
          <div
            className={cn(
              'flex items-center gap-1',
              collapsed ? 'lg:flex-col' : 'justify-between px-1',
            )}
          >
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggle}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden text-muted-foreground lg:inline-flex"
            >
              {collapsed ? (
                <ChevronRight className="size-4" aria-hidden />
              ) : (
                <ChevronLeft className="size-4" aria-hidden />
              )}
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}

// Exported ONLY so a test can render the signed-in header directly. Every
// check that mattered here ran signed-OUT, where the shell short-circuits to
// `SignedOut` and this bar never mounts — which is how a throw inside it
// reached production looking like a healthy deploy.
export function TopBar() {
  return (
    // The gutter is the SAME rung as `<main>`'s, so the breadcrumb starts on
    // the same vertical line as the content it names. It was 16px against a
    // 24px page at lg, which reads as a wobble on every scroll.
    <header className="glass sticky top-0 z-sticky flex h-14 shrink-0 items-center gap-2 border-b border-border px-card lg:px-card-lg">
      {/* ── THE BRAND, WHERE THE BREADCRUMB WAS ────────────────────────────
          The bar used to carry a dynamic trail ("Dashboard / Create event")
          and it WAS the page title — a separate <h1> saying the same word
          twice is the biggest waste of vertical space in most admin UIs.

          That argument still holds and the trail still went, at the owner's
          instruction, so the job it was doing has to land somewhere: every
          screen under this shell carries its own <h1> (the deck, the analytics
          hero, the gate list) and the footer bar marks the current tab. What
          the trail additionally gave — a link back UP a level — is what this
          lockup now is: it goes to `/dashboard`, which is the one destination
          the bar no longer has room to repeat on every screen.

          NOT the public home. Home is the bottom bar's job now, and a logo in
          an organizer shell that quietly exits the product is a trapdoor. */}
      <Link
        href="/dashboard"
        aria-label="Curatix dashboard"
        className="flex min-w-0 shrink-0 items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BrandLockup collapsed />
      </Link>

      {/* The spacer, so the two remaining controls sit hard right at every
          width. A `justify-between` on the header would also have to survive
          the bar being empty in the middle, which this does not care about. */}
      <span className="flex-1" aria-hidden />

      {/* ── WHAT IS LEFT, AND WHAT LEFT ────────────────────────────────────
          Search and the filled "Create event" pill are both gone.

          Create moved to the raised `+` in `OrganizerFooterNav`, so a second
          one here would have been the same action twice, four inches apart.

          Search opened the ⌘K palette, and the shell still listens for that
          binding — so the palette is intact for anybody with a keyboard and
          unreachable on a phone. That is the real cost of removing the button
          and it is stated here rather than discovered: the phone's answer is
          the sections grid on the dashboard landing plus the deck's own search
          field, both of which are reachable from the bottom bar. */}
      <NotificationBell />

      <AccountButton />
    </header>
  );
}

function AccountButton() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const initials = (user?.full_name || user?.email || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <div className="group relative shrink-0">
      {/* A quiet neutral medallion. The brand gradient that used to fill this
          made the account button the highest-contrast object in the bar —
          louder than the one action the bar is actually for. */}
      <button
        type="button"
        aria-label="Account"
        className="inline-flex h-control w-control items-center justify-center rounded-full bg-secondary text-caption font-semibold text-secondary-foreground transition-colors duration-fast hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:h-control-sm lg:w-control-sm"
      >
        {initials}
      </button>
      <div className="invisible absolute right-0 top-full z-dropdown mt-2 w-56 rounded-xl border border-border bg-elevated p-2 opacity-0 shadow-lg transition-opacity duration-fast group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
        <div className="border-b border-border px-2.5 pb-2 pt-1">
          <p className="truncate text-body-sm font-medium">{user?.full_name || 'Your account'}</p>
          <p className="truncate text-caption text-muted-foreground">{user?.email}</p>
        </div>
        <Link href="/" className={cn(menuRowClass, 'mt-1')}>
          <Ticket className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          Attendee site
        </Link>
        <button
          type="button"
          onClick={() => void signOut().then(() => router.push('/'))}
          className={menuRowClass}
        >
          <LogOut className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          Sign out
        </button>
      </div>
    </div>
  );
}

// `min-h-control` (44px) rather than padding alone — the same row shape the
// attendee site's account menu uses, so the one control an organizer touches on
// both products behaves identically.
const menuRowClass = cn(
  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-body-sm',
  'min-h-control transition-colors duration-fast hover:bg-muted',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
);

function SignedOut() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-card-lg">
      <div className="flex max-w-md flex-col items-center gap-stack-lg text-center">
        {/* A full viewport holding one heading and one button is the clearest
            place in the product for a drawing: nothing is competing with it,
            and it is the first thing an organizer sees. */}
        <SceneWelcome className="h-32" />
        <h1 className="text-h3">Sign in to your dashboard</h1>
        <Button asChild size="md" className="mt-stack">
          <Link href="/sign-in?next=%2Fdashboard">Sign in</Link>
        </Button>
      </div>
    </div>
  );
}


/**
 * What a non-approved account sees instead of the dashboard.
 *
 * It names WHERE IN THE FLOW they are, because "you do not have access" is
 * useless to somebody who applied yesterday and is waiting on a human. The
 * three states are the three real ones: no organization yet, one submitted and
 * under review, or one created but never submitted.
 */
function AwaitingApproval({ hasOrganization }: { hasOrganization: boolean }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-card-lg">
      <div className="flex max-w-md flex-col items-center gap-stack-lg text-center">
        {/* The spinner medallion that used to sit here implied something was
            LOADING. Nothing is: a human reviews this, over hours or days, and
            an animation that suggests otherwise makes people refresh. The
            drawing says "waiting" without claiming progress. */}
        <SpotListing className="size-28" />
        <h1 className="text-h3">
          {hasOrganization ? 'Your application is with our team' : 'Set up your organization first'}
        </h1>
        <p className="text-body-sm text-muted-foreground">
          {hasOrganization
            ? 'An operator reviews every organization by hand before it can publish events or receive payouts. You will get an email the moment it is decided.'
            : 'The organizer dashboard unlocks once you have created an organization and an operator has approved it.'}
        </p>
        <Button asChild size="md" className="mt-stack">
          <Link href="/account/organizer">
            {hasOrganization ? 'View application status' : 'Create an organization'}
          </Link>
        </Button>
      </div>
    </div>
  );
}
