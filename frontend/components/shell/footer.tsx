import * as React from 'react';
import Link from 'next/link';
import { Facebook, Instagram, Ticket } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { Container } from './container';

type FooterLink = { label: string; href: string };
type FooterColumn = { heading: string; links: FooterLink[] };

const COLUMNS: FooterColumn[] = [
  {
    heading: 'Discover',
    links: [
      { label: 'Browse events', href: '/events' },
      { label: 'This weekend', href: '/events?when=weekend' },
      { label: 'Popular cities', href: '/cities' },
    ],
  },
  {
    heading: 'Organizers',
    links: [
      { label: 'Start selling', href: '/organizer' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Help center', href: '/help' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Careers', href: '/careers' },
      { label: 'Contact', href: '/contact' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Terms', href: '/terms' },
      { label: 'Privacy', href: '/privacy' },
      { label: 'Cookies', href: '/cookies' },
    ],
  },
];

/** Rich footer: link columns, brand, and social — the SEO/brand anchor. */
export function Footer({ className }: { className?: string }) {
  return (
    <footer className={cn('border-t border-border bg-surface', className)}>
      <Container className="flex flex-col gap-10 py-12">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
          <div className="flex flex-col gap-3 lg:col-span-1">
            <Link href="/" className="inline-flex items-center gap-2 font-display text-h4">
              <Ticket className="size-6 text-primary" aria-hidden />
              Eventful
            </Link>
            <p className="text-body-sm text-muted-foreground">
              Discover live events and get in with a single scan.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <nav key={col.heading} aria-label={col.heading} className="flex flex-col gap-3">
              <p className="text-label text-foreground">{col.heading}</p>
              <ul className="flex flex-col gap-2">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="rounded-sm text-body-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="flex flex-col items-center justify-between gap-4 border-t border-border pt-6 sm:flex-row">
          <p className="text-body-sm text-muted-foreground">
            © {new Date().getFullYear()} Event &amp; Experience Platform
          </p>
          <div className="flex items-center gap-2">
            <Link
              href="https://instagram.com"
              aria-label="Instagram"
              className="rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Instagram className="size-5" aria-hidden />
            </Link>
            <Link
              href="https://facebook.com"
              aria-label="Facebook"
              className="rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Facebook className="size-5" aria-hidden />
            </Link>
          </div>
        </div>
      </Container>
    </footer>
  );
}
