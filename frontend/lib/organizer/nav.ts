import {
  Activity,
  BarChart3,
  CalendarPlus,
  LayoutDashboard,
  QrCode,
  Receipt,
  Ticket,
  Undo2,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

/**
 * The organizer dashboard's navigation, declared once.
 *
 * Sidebar, breadcrumbs and the ⌘K palette all read this list, so a section is
 * added in one place and can never appear in the sidebar but not in search.
 *
 * **Every destination here is built and backed by a real endpoint.** The brief
 * asked for several more sections — Settings, Coupons, Promotions, Team,
 * Messages, Reviews and Support. Settings is partly backed (the organization
 * profile, verification and payout account); the rest have no backend at all.
 * None is listed here until its page exists, because a nav item that 404s — or
 * that leads to a permanently empty screen — teaches an organizer to distrust
 * the whole dashboard, which is the same rule the operator console follows.
 * `frontend/BACKLOG.md` tracks each one.
 *
 * **Notifications is deliberately absent**, and it is the most tempting one to
 * fake. There is no per-organizer notification store: `notifications` is an
 * internal, event-driven module with no HTTP surface and no read/unread state,
 * so a bell icon here could only ever show a list this client invented and
 * "marked read" in its own localStorage. What an organizer actually needs from
 * a notification centre — what is wrong and what changed — is answered by the
 * attention panel and the activity timeline, both of which read real rows.
 * BACKLOG "Organizer notification centre" specifies the model it would need.
 */

export type OrganizerSection = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** What this page is, for the palette's second line. */
  hint: string;
};

export const ORGANIZER_SECTIONS: OrganizerSection[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    hint: "Today's revenue, bookings, tickets and activity",
  },
  {
    href: '/dashboard/events',
    label: 'Events',
    icon: Ticket,
    hint: 'Every event you run, with capacity, sales and revenue',
  },
  {
    href: '/dashboard/events/new',
    label: 'Create event',
    icon: CalendarPlus,
    hint: 'Six steps, saved as you type',
  },
  {
    href: '/dashboard/bookings',
    label: 'Bookings',
    icon: Receipt,
    hint: 'Orders across your events, by customer or payment reference',
  },
  {
    href: '/dashboard/customers',
    label: 'Customers',
    icon: Users,
    hint: 'Who buys from you, what they are worth, and their history',
  },
  {
    href: '/dashboard/analytics',
    label: 'Analytics',
    icon: BarChart3,
    hint: 'Revenue and booking trends, conversion, repeat rate',
  },
  {
    href: '/dashboard/check-in',
    label: 'Check-in',
    icon: QrCode,
    hint: 'Scan tickets at the gate, with live attendance',
  },
  {
    href: '/dashboard/payouts',
    label: 'Payouts',
    icon: Wallet,
    hint: 'What has settled, what is owed, and when it releases',
  },
  {
    href: '/dashboard/refunds',
    label: 'Refunds',
    icon: Undo2,
    hint: 'Money already returned, and why',
  },
  {
    href: '/dashboard/activity',
    label: 'Activity',
    icon: Activity,
    hint: 'One timeline across bookings, refunds, gates and payouts',
  },
];

/** The trail for a path, derived rather than declared per page. */
export function organizerBreadcrumbs(pathname: string): { label: string; href?: string }[] {
  const trail: { label: string; href?: string }[] = [{ label: 'Dashboard', href: '/dashboard' }];
  if (pathname === '/dashboard') return trail;

  // Longest match wins, so /dashboard/events/new resolves to "Create event"
  // rather than to "Events" plus a bare segment.
  const match = [...ORGANIZER_SECTIONS]
    .filter((section) => section.href !== '/dashboard' && pathname.startsWith(section.href))
    .sort((a, b) => b.href.length - a.href.length)[0];

  if (match) {
    trail.push(
      pathname === match.href ? { label: match.label } : { label: match.label, href: match.href },
    );
  }
  if (match && pathname !== match.href) {
    const rest = pathname.slice(match.href.length).split('/').filter(Boolean);
    // Ids are not labels. A uuid in a breadcrumb is noise; the page itself
    // shows what it is about.
    const tail = rest.filter((segment) => !/^[0-9a-f-]{20,}$/i.test(segment));
    for (const segment of tail) {
      trail.push({ label: segment.replace(/-/g, ' ') });
    }
  }
  return trail;
}

export function isSectionActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  // /dashboard/events must not light up while on /dashboard/events/new.
  if (href === '/dashboard/events') {
    return pathname === '/dashboard/events' || /^\/dashboard\/events\/(?!new)/.test(pathname);
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
