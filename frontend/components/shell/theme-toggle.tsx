'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme/theme-provider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

/**
 * Light/dark toggle.
 *
 * Both icons always render and CSS picks per theme, so it is hydration-safe
 * with the no-FOUC init script — the server cannot know the theme, and a
 * toggle that renders the wrong glyph for a frame is the one control where
 * that is immediately obvious.
 *
 * They swap by ROTATING PAST EACH OTHER rather than hard-switching `hidden`,
 * which is the same trick and costs nothing extra: the sun winds out as the
 * moon winds in. It cannot fire on arrival either — a transition needs a
 * previous computed value to move from, and on first paint there isn't one.
 *
 * ── TWO THINGS HERE ARE LOAD-BEARING ──────────────────────────────────────
 *
 * 1. The aria-label FORMULA. Three e2e tests click this control by the name
 *    `/switch to dark theme/i`; rewording it breaks them silently.
 * 2. The 44px box. It inherits `Button` `size="icon"` (h-11 w-11) and only
 *    overrides the radius — if that variant ever shrinks, this bar's action
 *    row drops below the touch-target floor, and so do the admin console's and
 *    the organizer dashboard's, which render this same component.
 *
 * The quiet neutral treatment (ink glyph, muted hover fill, no brand tint) is
 * `Button`'s `ghost` variant unmodified, which is exactly right for chrome you
 * set once — so there is nothing to restyle here beyond the pill radius.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, toggle } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      className={cn('rounded-full', className)}
      aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}
    >
      <span className="relative inline-flex size-5 items-center justify-center" aria-hidden>
        <Sun className="absolute size-5 rotate-0 scale-100 transition-transform duration-base ease-spring motion-reduce:transition-none dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute size-5 rotate-90 scale-0 transition-transform duration-base ease-spring motion-reduce:transition-none dark:rotate-0 dark:scale-100" />
      </span>
    </Button>
  );
}
