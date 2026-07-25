'use client';

import * as React from 'react';
import Link from 'next/link';
import { Ticket } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { Container } from './container';
import { ThemeToggle } from './theme-toggle';

export interface HeaderProps {
  /** Brand slot (defaults to a placeholder logo). */
  logo?: React.ReactNode;
  /** Primary nav slot (rendered inline on md+). */
  nav?: React.ReactNode;
  /** Search slot (rendered centered on lg+). */
  search?: React.ReactNode;
  /** Right-side actions slot (sign-in, "Start selling", etc.). */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Sticky app header that CONDENSES on scroll (shrinks height, adds a blurred
 * background + shadow) — §10.3. Composed from slots; the shell provides the
 * chrome, feature code fills the nav/search/actions later.
 */
export function Header({ logo, nav, search, actions, className }: HeaderProps) {
  const [scrolled, setScrolled] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'sticky top-0 z-sticky border-b transition-all duration-base ease-out',
        scrolled
          ? 'border-border bg-background/80 shadow-sm backdrop-blur-md'
          : 'border-transparent bg-background',
        className,
      )}
    >
      <Container
        className={cn(
          'flex items-center gap-4 transition-all duration-base ease-out',
          scrolled ? 'h-14' : 'h-16',
        )}
      >
        <div className="flex items-center gap-6">
          {logo ?? (
            <Link href="/" className="inline-flex items-center gap-2 font-display text-h4">
              <Ticket className="size-6 text-primary" aria-hidden />
              Eventful
            </Link>
          )}
          {nav ? <nav className="hidden items-center gap-1 md:flex">{nav}</nav> : null}
        </div>

        {search ? (
          <div className="hidden flex-1 justify-center px-4 lg:flex">{search}</div>
        ) : (
          <div className="flex-1" />
        )}

        <div className="flex items-center gap-2">
          {actions}
          <ThemeToggle />
        </div>
      </Container>
    </header>
  );
}
