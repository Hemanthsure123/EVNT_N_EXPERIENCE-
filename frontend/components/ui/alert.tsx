import * as React from 'react';
import { type VariantProps, cva } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

const alertVariants = cva('relative flex w-full items-start gap-3 rounded-lg border p-4', {
  variants: {
    variant: {
      default: 'border-border bg-surface text-foreground',
      info: 'border-info/30 bg-info-subtle text-info-subtle-foreground',
      success: 'border-success/30 bg-success-subtle text-success-subtle-foreground',
      warning: 'border-warning/30 bg-warning-subtle text-warning-subtle-foreground',
      destructive: 'border-destructive/30 bg-destructive-subtle text-destructive-subtle-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  icon?: React.ReactNode;
}

/** Inline alert / banner. Pass an `icon` and compose with AlertTitle/Description. */
export function Alert({ className, variant, icon, children, ...props }: AlertProps) {
  return (
    <div role="alert" className={cn(alertVariants({ variant }), className)} {...props}>
      {icon ? (
        <span className="mt-0.5 shrink-0" aria-hidden>
          {icon}
        </span>
      ) : null}
      <div className="flex-1">{children}</div>
    </div>
  );
}

export function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-body-sm font-semibold', className)} {...props} />;
}

export function AlertDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-body-sm opacity-90', className)} {...props} />;
}

export { alertVariants };
