'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Loader2, Menu, PanelLeftClose, Search, ShieldAlert, X } from 'lucide-react';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { useAuth } from '@/lib/auth/auth-provider';
import { ADMIN_SECTIONS, adminBreadcrumbs } from '@/lib/admin/nav';
import { BrandMark } from '@/components/shell/brand-mark';
import { cn } from '@/lib/utils/cn';
import { AdminCommandPalette } from './command-palette';
import { useAdminAttentionBadge } from './attention-panel';
import { UndoProvider } from './undo';
import { NotificationBell } from './notifications';
import { UserMenu } from './user-menu';

/**
 * The console's frame: sidebar, header, and the guard around both.
 *
 * SAME DESIGN LANGUAGE AS THE PUBLIC SITE, deliberately — the same tokens,
 * radii, shadows and theme toggle. An admin area with its own palette is a
 * second product to maintain, and operators are the people most likely to be
 * moving between the two all day.
 *
 * ── BUT AN OPERATIONS FRAME IS NOT A CONSUMER FRAME ───────────────────────
 *
 * What it takes from the shared contract is the palette, the pill shapes and
 * the two "you are here" / "press this" fills. What it does NOT take is the
 * marketing site's whitespace: the header is one row of 44px controls, the main
 * region uses card padding rather than a page gutter, and nothing decorative
 * sits above the first row of data.
 *
 * THREE FILLS, THREE MEANINGS, and the frame only ever uses two of them:
 *   `--nav-active`  the warm butter pill — "you are here". The active sidebar
 *                   item and the operator's own avatar.
 *   `--primary`     violet, WAYFINDING ONLY — the brand mark and the search
 *                   glyph. Never a button fill.
 *   `--cta`         the near-black pill, THE primary action. There is exactly
 *                   one in this file, on the access-denied screen, because
 *                   that is the only screen here with a single obvious action.
 * The console chrome deliberately carries no filled CTA: every control in the
 * header is navigation or a preference, and a black pill among them would
 * claim to be the thing to press.
 *
 * THE GUARD IS UX, NOT SECURITY. Every `/admin/*` endpoint enforces `is_staff`
 * on the server; this only decides what to render while the browser waits, and
 * spares a non-admin a screen of failing widgets. It renders nothing at all
 * until auth resolves, so an admin never sees "access denied" flash before
 * their own dashboard appears.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/admin';
  const { status, isAdmin } = useAuth();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  // Close the drawer on navigation — a sidebar that stays open over the page
  // you just asked for is the most common mobile admin annoyance.
  React.useEffect(() => setSidebarOpen(false), [pathname]);

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

  if (!isAdmin) return <NotAuthorised signedIn={status === 'authenticated'} />;

  return (
    <div className="flex min-h-dvh bg-background">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} pathname={pathname} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-sticky flex h-header items-center gap-2 border-b border-border px-4 lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
            aria-expanded={sidebarOpen}
            aria-controls="admin-sidebar"
            className="lg:hidden"
          >
            <Menu className="size-5" aria-hidden />
          </Button>

          <Breadcrumb items={adminBreadcrumbs(pathname)} className="hidden min-w-0 sm:block" />

          {/* One control, two shapes: a 44px icon button below `md`, the
              labelled pill above it. Two elements would be two focus stops for
              one action, and the label only earns its width once the breadcrumb
              beside it has stopped competing for the row. The violet glyph is
              the wayfinding accent doing its documented job — it marks search,
              it does not fill a button. */}
          <Button
            variant="outline"
            size="icon"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search the console"
            aria-keyshortcuts="Meta+K Control+K"
            className="ml-auto md:w-auto md:px-pill"
          >
            <Search className="size-4 shrink-0 text-primary" aria-hidden />
            <span className="hidden font-normal text-muted-foreground md:inline">Search…</span>
            <kbd className="hidden rounded-full border border-border px-1.5 py-0.5 text-caption text-muted-foreground md:inline">
              ⌘K
            </kbd>
          </Button>

          <NotificationBell />
          <ThemeToggle />
          <UserMenu />
        </header>

        <main id="admin-main" className="min-w-0 flex-1 p-card lg:p-card-lg">
          {/* The undo host wraps the console rather than each page, so a toast
              survives a navigation — an operator who suspends an account and
              immediately clicks through to another section can still undo. */}
          <UndoProvider>{children}</UndoProvider>
        </main>
      </div>

      <AdminCommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

/**
 * The sidebar's one badge.
 *
 * Renders NOTHING at zero rather than a grey "0" — a counter that is always
 * present is furniture, and furniture does not get looked at. It reads the
 * same `useAdminAttention` hook the overview panel does, so the sidebar number
 * and the list on the page can never disagree; TanStack dedupes the underlying
 * queries, so it costs no extra request.
 */
function AttentionDot() {
  const count = useAdminAttentionBadge();
  if (count === 0) return null;
  return (
    <span
      className="ml-auto inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-destructive px-1.5 text-caption tabular-nums text-destructive-foreground"
      aria-label={`${count} item${count === 1 ? '' : 's'} need an operator`}
    >
      {count}
    </span>
  );
}

function Sidebar({
  open,
  onClose,
  pathname,
}: {
  open: boolean;
  onClose: () => void;
  pathname: string;
}) {
  return (
    <>
      {/* Off-canvas below `lg`, permanent above it. One element, two
          behaviours — a separate mobile nav would drift from this one. */}
      {open ? (
        <div
          className="fixed inset-0 z-drawer bg-overlay/70 lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      ) : null}

      <aside
        id="admin-sidebar"
        className={cn(
          'fixed inset-y-0 left-0 z-drawer flex w-64 shrink-0 flex-col border-r border-border bg-surface',
          'transition-transform duration-base ease-spring lg:static lg:translate-x-0',
          'motion-reduce:transition-none',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Console navigation"
      >
        {/* `h-header` rather than a repeated number, so the brand block and the
            content header are the same height by token rather than by luck. */}
        <div className="flex h-header shrink-0 items-center gap-2 border-b border-border px-3">
          <Link
            href="/"
            className="inline-flex min-w-0 items-center gap-2 rounded-full px-1 font-display text-body-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {/* THE product mark, not a stand-in.

                Both console shells drew a lucide `Ticket` glyph here while the
                public site drew the CX monogram — so the same product had two
                different logos depending on which half of it you were in, and
                an organizer moving between the site and their dashboard saw the
                brand change under them. `BrandMark` is the one definition
                (`components/shell/brand-mark.tsx`); it inherits `currentColor`,
                so it takes the sidebar's ink without a second asset. */}
            <BrandMark className="size-5 shrink-0 text-foreground" title="" />
            <span className="truncate">Curatix</span>
          </Link>
          <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-caption text-secondary-foreground">
            Console
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close navigation"
            className="ml-auto lg:hidden"
          >
            <PanelLeftClose className="size-4" aria-hidden />
          </Button>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {ADMIN_SECTIONS.map((section) => {
            const active =
              section.href === '/admin' ? pathname === '/admin' : pathname.startsWith(section.href);
            return (
              <Link
                key={section.href}
                href={section.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-control items-center gap-3 rounded-full px-3 py-2 text-body-sm transition-colors duration-fast',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                  // "You are here" is the warm butter pill, NOT the near-black
                  // CTA and NOT the brand violet: twelve near-black rows would
                  // put twelve primary actions in the frame, and a violet one
                  // would read as the thing to press rather than the thing you
                  // are already looking at.
                  active
                    ? 'bg-nav-active font-semibold text-nav-active-foreground hover:bg-nav-active-hover'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <section.icon className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 truncate">{section.label}</span>
                {/* CRITICAL items only, and only on Overview. A badge on five
                    sections at once is a badge nobody reads, and one counting
                    "for information" items would never reach zero — which is
                    how people learn to ignore it. */}
                {section.href === '/admin' ? <AttentionDot /> : null}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-2">
          <Link
            href="/"
            className="flex min-h-control items-center gap-3 rounded-full px-3 py-2 text-caption text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <X className="size-3.5 shrink-0" aria-hidden />
            Leave the console
          </Link>
        </div>
      </aside>
    </>
  );
}

function NotAuthorised({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-card">
      {/* The one screen in the frame with a single obvious action, so it is the
          one place the near-black CTA pill belongs. */}
      <div className="flex max-w-md flex-col items-start gap-stack-lg rounded-2xl border border-border bg-surface p-card-lg shadow-md">
        <span
          className="inline-flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
          aria-hidden
        >
          <ShieldAlert className="size-6" />
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="text-h4">Operator access only</h1>
          <p className="text-body-sm text-muted-foreground">
            {signedIn
              ? 'Your account is signed in but is not a platform operator. If that looks wrong, ask an admin to grant staff access.'
              : 'Sign in with a platform operator account to open the console.'}
          </p>
        </div>
        <Button asChild>
          <Link href="/">Back to Curatix</Link>
        </Button>
      </div>
    </div>
  );
}
