'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme/theme-provider';
import { Button } from '@/components/ui/button';

/** Light/dark toggle. Both icons render; CSS shows the right one per theme, so
 * it's hydration-safe with the no-FOUC init script. */
export function ThemeToggle() {
  const { resolvedTheme, toggle } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}
    >
      <Sun className="size-5 dark:hidden" aria-hidden />
      <Moon className="hidden size-5 dark:block" aria-hidden />
    </Button>
  );
}
