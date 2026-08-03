'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * Button — the ONE primary-action shape in the product.
 *
 * ── WHY THIS CHANGED, AND WHY IT HAD TO ──────────────────────────────────
 *
 * `primary` was a violet `rounded-md` rectangle. The redesign made the primary
 * action a NEAR-BLACK PILL, and the feature areas that were migrated first
 * expressed that as local class contracts (`components/booking/cta.ts`,
 * `components/discovery/cta.tsx`) rather than changing this file — reasonably,
 * since this component is shared with the admin console and the organizer
 * dashboard, which had not been redesigned yet.
 *
 * The result was TWO primary-action languages living side by side: a black pill
 * wherever a contract was imported, and a violet rectangle everywhere the 33
 * files that render `<Button>` still did. That is precisely the inconsistency
 * the redesign exists to remove, so the primitive now carries the language and
 * the contracts agree with it rather than working around it.
 *
 * ── THE BLAST RADIUS IS DELIBERATE ───────────────────────────────────────
 *
 * This lands in the admin and organizer portals immediately, before they are
 * redesigned. That is the correct direction: near-black is neutral, it is where
 * those portals are heading anyway, and one action language across all four
 * portals from today beats a violet/black split that has to be reconciled later.
 *
 * ── `brand` KEEPS THE OLD FILL ───────────────────────────────────────────
 *
 * Not every filled button is a primary action. `brand` preserves the violet so
 * anything that genuinely wants the accent — a promotional surface, a control
 * that must not read as THE action on its screen — can still ask for it by name
 * instead of by accident.
 *
 * Radius is a pill, sizes come from the shared control-height tokens so a button
 * and an input and a chip line up, and horizontal padding uses `px-pill*`
 * because a fully-rounded corner eats the ends of its own label.
 */
const buttonVariants = cva(
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full text-label ring-offset-background transition duration-fast ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60',
  {
    variants: {
      variant: {
        // THE primary action. Near-black in light, near-white in dark — the
        // `--cta` family, deliberately separate from `--primary`, which stayed
        // violet and now means "brand accent" (see styles/tokens.css).
        primary: 'bg-cta text-cta-foreground hover:bg-cta-hover active:bg-cta-active shadow-sm',
        brand:
          'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'bg-transparent text-foreground hover:bg-muted',
        outline: 'border border-border bg-surface text-foreground hover:bg-muted',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
      size: {
        sm: 'h-control-sm px-pill',
        md: 'h-control px-pill',
        lg: 'h-control-lg px-pill-lg text-body',
        // Square-ish, so it renders as a circle at `rounded-full`. No pill
        // padding: an icon button has no label for the corners to eat.
        icon: 'h-control w-control px-0',
      },
      emphasis: {
        // A violet glow under a near-black pill is the wrong light. Emphasis is
        // now elevation, which reads on both fills and in both themes.
        true: 'shadow-lg',
        false: '',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md', emphasis: false },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    emphasis,
    asChild = false,
    loading = false,
    leftIcon,
    rightIcon,
    children,
    disabled,
    ...props
  },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size, emphasis }), className)}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : leftIcon}
          {children}
          {!loading && rightIcon}
        </>
      )}
    </Comp>
  );
});

export { buttonVariants };
