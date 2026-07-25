'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

export interface BottomNavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

/** Mobile bottom navigation (hidden on md+). Marks the active route. */
export function BottomNav({ items, className }: { items: BottomNavItem[]; className?: string }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className={cn(
        'fixed inset-x-0 bottom-0 z-sticky border-t border-border bg-background/90 backdrop-blur-md md:hidden',
        className,
      )}
    >
      <ul className="flex items-stretch justify-around">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-16 flex-col items-center justify-center gap-1 text-caption transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <span aria-hidden>{item.icon}</span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
