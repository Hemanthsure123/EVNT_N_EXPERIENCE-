import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/** Skeleton placeholder with the shimmer sweep (styles/globals `.skeleton`).
 * Shape it like the real content it stands in for (§ system states). */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn('skeleton rounded-md', className)} {...props} />;
}
