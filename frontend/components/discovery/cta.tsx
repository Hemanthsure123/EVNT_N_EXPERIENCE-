import * as React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * The landing page's call-to-action buttons — one vocabulary, defined once.
 *
 * ── THE PRIMARY IS A BLACK PILL ───────────────────────────────────────────
 *
 * Fully rounded, near-black fill, white label, `px-pill-lg` of horizontal room.
 * It fills with `--cta` and NOT with `--primary`: those are two tokens now, and
 * `--primary` is the wayfinding violet (a search icon, a date, a focus ring),
 * never a call to action. In dark theme the pill inverts to near-white with
 * dark ink, which is why its label is `--cta-foreground` rather than
 * `--on-gradient` — the latter is white in both themes and would vanish.
 *
 * ── WHY THIS IS NOT THE SHARED `Button` ───────────────────────────────────
 *
 * `components/ui/button.tsx` is the whole application's button, including the
 * checkout's. The design system is explicit that a screen where somebody types
 * a card number should not be playful, so the flourish below deliberately does
 * not live there. This is the marketing surface's button: same tokens, same
 * sizes, more personality, and it cannot leak into the funnel because the
 * funnel does not import it.
 *
 * ── THE INTERACTION, IN THREE BEATS ───────────────────────────────────────
 *
 * 1. **Hover lifts it** 2px and deepens the shadow — the idiom already used by
 *    the category tiles, the city cards and the quick filters, so the page has
 *    ONE hover language rather than six.
 * 2. **Press puts it back down** and scales to 0.98. This is the beat the
 *    landing page was missing everywhere: things rose when you pointed at them
 *    and then did nothing at all when you actually clicked, which reads as the
 *    click not registering. The press cancels the lift on purpose — rising and
 *    then being pushed in is what a physical button does.
 * 3. **The arrow travels** on a forward action, because the arrow is a promise
 *    about where the press goes.
 *
 * The sheen on the primary is the one frankly decorative thing here, and it is
 * a considered exception to "decorative motion is deleted": this is the front
 * page's single most important control, it fires only on deliberate hover, and
 * it is one composited transform. It is not repeated anywhere else, which is
 * what keeps it feeling like an accent instead of a tic.
 *
 * Everything animates `transform`/`opacity`/`box-shadow` only — no layout
 * property is touched — and every beat is disabled under
 * `prefers-reduced-motion`, including the sheen, which is removed outright
 * rather than shortened.
 *
 * A server component: it is a link with class names, so it ships no JS.
 */

const BASE = cn(
  'group relative inline-flex h-control-lg shrink-0 select-none items-center justify-center gap-2',
  // `overflow-hidden` clips the sheen to the button's radius. It does not clip
  // the focus ring, which is a box-shadow drawn outside the border box.
  // FULLY ROUNDED, with `px-pill-lg` rather than a picked number: the corners
  // of a pill eat the ends of its label, so it needs more horizontal room than
  // a rectangle at the same optical weight, and every CTA shares the token.
  'overflow-hidden rounded-full px-pill-lg text-label',
  'transition-[transform,box-shadow,background-color,border-color] duration-base ease-spring',
  'hover:-translate-y-0.5',
  // Faster on the way down than on the way up: a press should feel immediate,
  // a hover should feel smooth.
  'active:translate-y-0 active:scale-[0.98] active:duration-fast',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  'motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100',
);

const VARIANTS = {
  // THE BLACK PILL. `--cta`, not `--primary`: the primary ACTION is near-black
  // on white in light and near-white on dark in dark, while `--primary` stays
  // violet and is spent only on wayfinding now. Getting this wrong is the one
  // mistake that shows up everywhere at once.
  primary: cn(
    'bg-cta text-cta-foreground shadow-md hover:bg-cta-hover hover:shadow-lg',
    // The sheen: a skewed highlight parked off the left edge that sweeps across
    // on hover. `cta-foreground` rather than a raw white — it is the token that
    // means "the colour that belongs on top of the action", so it tracks the
    // theme instead of being a picture of one of them. (On the dark theme's
    // near-white pill the sweep is a dark shimmer, which is correct.)
    'before:absolute before:inset-0 before:-translate-x-full before:skew-x-12',
    'before:bg-gradient-to-r before:from-transparent before:via-cta-foreground/25 before:to-transparent',
    // The transition is declared only in the hover state, so the sweep runs on
    // the way in and SNAPS back on the way out. Transitioning both ways makes
    // the highlight travel backwards when the pointer leaves, which reads as a
    // second, unexplained animation.
    'hover:before:translate-x-full hover:before:transition-transform hover:before:duration-slow hover:before:ease-out',
    'motion-reduce:before:hidden',
  ),
  secondary: cn(
    'border border-border bg-surface text-foreground shadow-sm',
    // A neutral hover edge. A violet one was the brand asking for attention on
    // the control that is deliberately NOT the primary action.
    'hover:border-border-strong hover:bg-muted hover:shadow-md',
  ),
} as const;

export function Cta({
  href,
  children,
  variant = 'primary',
  withArrow = variant === 'primary',
  className,
}: {
  href: string;
  children: React.ReactNode;
  variant?: keyof typeof VARIANTS;
  /** Forward actions carry the arrow; "browse" style destinations do not. */
  withArrow?: boolean;
  className?: string;
}) {
  return (
    <Link href={href} className={cn(BASE, VARIANTS[variant], className)}>
      {/* Above the sheen. Without a stacking context of its own the highlight
          washes over the label instead of behind it. */}
      <span className="relative inline-flex items-center gap-2">
        {children}
        {withArrow ? (
          <ArrowRight
            className="size-4 transition-transform duration-base ease-spring group-hover:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
            aria-hidden
          />
        ) : null}
      </span>
    </Link>
  );
}
