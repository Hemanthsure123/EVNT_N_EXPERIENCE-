import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export interface SpinnerProps extends React.HTMLAttributes<SVGElement> {
  label?: string;
}

/** Accessible loading spinner (role=status + label for screen readers). */
export function Spinner({ className, label = 'Loading', ...props }: SpinnerProps) {
  return (
    <Loader2
      role="status"
      aria-label={label}
      className={cn('size-5 animate-spin text-primary', className)}
      {...props}
    />
  );
}
