import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export interface ContainerProps extends React.HTMLAttributes<HTMLElement> {
  as?: React.ElementType;
}

/** Responsive page container — centered, max 1280px, token gutters (§6.2). */
export function Container({ as: Comp = 'div', className, ...props }: ContainerProps) {
  return (
    <Comp className={cn('mx-auto w-full max-w-container px-4 lg:px-6', className)} {...props} />
  );
}
