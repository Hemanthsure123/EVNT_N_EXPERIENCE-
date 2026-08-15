import {
  BarChart3,
  Activity,
  Building2,
  CreditCard,
  History,
  LayoutDashboard,
  LayoutTemplate,
  Megaphone,
  MessageSquare,
  Music4,
  Receipt,
  ShieldCheck,
  Stamp,
  Undo2,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

/**
 * The console's navigation, declared once.
 *
 * Sidebar, breadcrumbs and the command palette all read this, so a new
 * section is added in exactly one place and can never appear in the sidebar
 * but not in search.
 *
 * Every destination here is backed by a real endpoint. There are no sections
 * for things the platform cannot answer — an admin nav item leading to a
 * permanently empty screen teaches an operator to distrust the whole console.
 *
 * **Bookings** is the support desk, added because the single most common
 * question support gets — "I paid but have no ticket" — could not be answered
 * from the product at all: `GET /bookings/{id}` is scoped to the booking's own
 * owner, so an operator could not open one even holding the id.
 *
 * **Support (a ticketing/conversation system) is still deliberately absent**,
 * and it is the most tempting one to add.
 * There is no ticket model, no conversation, no assignment and no priority —
 * a Support section could only ever show an empty list and a "New ticket"
 * button that writes nowhere, while implying to every operator that customer
 * messages are being captured somewhere. They are not. BACKLOG item 49
 * specifies the module it needs.
 */

export type AdminSection = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** What this page is, for the palette's second line. */
  hint: string;
};

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    href: '/admin',
    label: 'Overview',
    icon: LayoutDashboard,
    hint: 'Platform totals, revenue, activity and health',
  },
  {
    // Per-EVENT analytics. Platform-wide totals stay on the Overview; this is
    // the screen that answers "how is that one doing", which the console could
    // not answer at all — `AdminEventAnalytics` was built against a working
    // endpoint and never given a route.
    href: '/admin/analytics',
    label: 'Event analytics',
    icon: BarChart3,
    hint: 'Sales, check-ins and refunds for one event',
  },
  {
    href: '/admin/homepage',
    label: 'Homepage',
    icon: LayoutTemplate,
    hint: 'Hero copy, trust badges, ribbon and categories',
  },
  {
    href: '/admin/announcements',
    label: 'Announcements',
    icon: Megaphone,
    hint: 'Maintenance notices, launches and incidents',
  },
  {
    href: '/admin/moderation',
    // "Moderation" named the ACTION, not the contents. The screen already
    // carries every event on the platform across its status tabs — pending,
    // approved, sent back, archived — so an operator looking for a specific
    // event had no reason to think it lived under a word that means "review
    // queue". Approving is one of the things you do here; it is not what this
    // is.
    label: 'All events',
    icon: Stamp,
    hint: 'Every event on the platform — review, approve, send back or remove',
  },
  {
    // The hire desk. This REPLACED a performer-moderation queue, and the
    // difference is the whole product change: there is no marketplace to
    // moderate any more. Somebody wanting a band sends what they need and an
    // operator gets back to them — this is where that lands, and it is the
    // only place it lands, because nothing is matched automatically.
    href: '/admin/enquiries',
    label: 'Hire enquiries',
    icon: Music4,
    hint: 'People asking to hire an act — read it, call them, close it',
  },
  {
    href: '/admin/verifications',
    label: 'Verifications',
    icon: ShieldCheck,
    hint: 'Approve or reject organizer verification requests',
  },
  {
    href: '/admin/organizations',
    label: 'Organizations',
    icon: Building2,
    hint: 'Every organization on the platform',
  },
  {
    href: '/admin/users',
    label: 'Users',
    icon: Users,
    hint: 'Accounts, roles, and suspension',
  },
  {
    href: '/admin/bookings',
    label: 'Bookings',
    icon: Receipt,
    hint: 'Find a booking by email, reference or event — the support desk',
  },
  {
    href: '/admin/payments',
    label: 'Payments',
    icon: CreditCard,
    hint: 'Every transaction and refund on the platform',
  },
  {
    href: '/admin/refund-requests',
    label: 'Refund requests',
    icon: Undo2,
    hint: 'Customers asking for their money back — approve or decline',
  },
  {
    href: '/admin/support',
    label: 'Support',
    icon: MessageSquare,
    hint: 'Customer queries addressed to the platform',
  },
  {
    href: '/admin/settlements',
    label: 'Settlements',
    icon: Wallet,
    hint: 'Payouts, failures and manual release',
  },
  {
    href: '/admin/health',
    label: 'System health',
    icon: Activity,
    hint: 'Probed dependencies, configured adapters, and what is not measured',
  },
  {
    href: '/admin/audit',
    label: 'Audit log',
    icon: History,
    hint: 'Who did what, and when. Append-only.',
  },
];

/** The trail for a path, derived rather than declared per page. */
export function adminBreadcrumbs(pathname: string): { label: string; href?: string }[] {
  const trail: { label: string; href?: string }[] = [{ label: 'Console', href: '/admin' }];
  if (pathname === '/admin') return [{ label: 'Console' }];
  // Longest match wins, so a nested route resolves to its own section rather
  // than to a shorter prefix that happens to match first.
  const section = [...ADMIN_SECTIONS]
    .filter((entry) => entry.href !== '/admin' && pathname.startsWith(entry.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (section) trail.push({ label: section.label });
  return trail;
}
