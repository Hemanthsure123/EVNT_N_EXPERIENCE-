import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

/** Selectable filter chip / category pill (§ engagement). Renders as a toggle
 * button with an accessible pressed state. */
export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { className, selected, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-label transition duration-fast ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:pointer-events-none disabled:opacity-60',
        selected
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-surface text-foreground hover:bg-muted',
        className,
      )}
      {...props}
    />
  );
});
