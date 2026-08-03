import {
  Activity,
  Building2,
  Music4,
  CreditCard,
  History,
  LayoutTemplate,
  Megaphone,
  LayoutDashboard,
  ShieldCheck,
  Stamp,
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
 * **Support is deliberately absent**, and it is the most tempting one to add.
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
    label: 'Moderation',
    icon: Stamp,
    hint: 'Approve or send back events awaiting review',
  },
  {
    href: '/admin/performers',
    label: 'Performers',
    icon: Music4,
    hint: 'Approve, send back and feature marketplace acts',
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
    href: '/admin/payments',
    label: 'Payments',
    icon: CreditCard,
    hint: 'Every transaction and refund on the platform',
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
