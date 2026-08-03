'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { type VariantProps, cva } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

const drawerVariants = cva(
  'fixed z-drawer flex flex-col border-border bg-elevated text-foreground shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out',
  {
    variants: {
      side: {
        bottom:
          'inset-x-0 bottom-0 max-h-[90vh] rounded-t-2xl border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
        right:
          'inset-y-0 right-0 h-full w-3/4 max-w-sm border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
        left: 'inset-y-0 left-0 h-full w-3/4 max-w-sm border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
        /**
         * A bottom sheet where the thumb is, a left slide-over where there's
         * room for one. Same component, so the contents are written once.
         * The `-from-top-0`/`-to-top-0` pairs zero the vertical offset the
         * bottom variant sets, or the panel would enter diagonally at `lg`.
         */
        responsive:
          'inset-x-0 bottom-0 max-h-[90vh] rounded-t-2xl border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom lg:inset-y-0 lg:right-auto lg:h-full lg:max-h-none lg:w-full lg:max-w-md lg:rounded-t-none lg:border-r lg:border-t-0 lg:data-[state=closed]:slide-out-to-left lg:data-[state=closed]:slide-out-to-top-0 lg:data-[state=open]:slide-in-from-left lg:data-[state=open]:slide-in-from-top-0',
      },
    },
    defaultVariants: { side: 'bottom' },
  },
);

export interface DrawerContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof drawerVariants> {
  hideClose?: boolean;
  /**
   * Skip the built-in scrolling body. Use it when the panel needs a pinned
   * header/footer with only the middle scrolling — the default wrapper would
   * scroll the footer away with the content.
   */
  bare?: boolean;
}

/** Slide-over panel — a bottom sheet on mobile, a side drawer on larger screens. */
export const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DrawerContentProps
>(function DrawerContent({ className, children, side = 'bottom', hideClose, bare, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      {/* A plain scrim, NOT a backdrop-filter. A full-viewport blur is the most
          expensive paint this app can ask for — it measurably lengthened the
          open interaction on a throttled CPU — and over a dimmed page it is
          nearly indistinguishable from the scrim alone. Real blur is reserved
          for the two small persistent bars (see `.glass` in globals.css). */}
      <DialogPrimitive.Overlay className="fixed inset-0 z-drawer bg-overlay/70 animate-in fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(drawerVariants({ side }), className)}
        {...props}
      >
        {side === 'bottom' || side === 'responsive' ? (
          <div
            className={cn(
              'mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-border',
              // The grab handle is a bottom-sheet affordance; at `lg` the
              // responsive variant is a side panel and shouldn't imply a swipe.
              side === 'responsive' && 'lg:hidden',
            )}
            aria-hidden
          />
        ) : null}
        {bare ? children : <div className="flex-1 overflow-auto p-6">{children}</div>}
        {!hideClose ? (
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute right-4 top-4 rounded-sm text-muted-foreground opacity-80 transition hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-5" aria-hidden />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DrawerTitle({ className, ...props }, ref) {
  return <DialogPrimitive.Title ref={ref} className={cn('text-h4', className)} {...props} />;
});

export const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DrawerDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn('text-body-sm text-muted-foreground', className)}
      {...props}
    />
  );
});
