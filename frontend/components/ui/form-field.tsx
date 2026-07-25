import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export interface FormFieldProps {
  /** Text label rendered above the control (associated via htmlFor). */
  label?: React.ReactNode;
  /** id of the control this labels/describes (wires label + aria-describedby). */
  htmlFor?: string;
  description?: React.ReactNode;
  /** Inline error message (e.g. from react-hook-form + zod). */
  error?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * A labelled form control wrapper: label + control + helper/description + inline
 * error, wired for accessibility. Pairs with react-hook-form + zod — pass the
 * field's `error?.message` to `error`, and put the matching `id` on the control.
 */
export function FormField({
  label,
  htmlFor,
  description,
  error,
  required,
  className,
  children,
}: FormFieldProps) {
  const describedBy = [
    description && htmlFor ? `${htmlFor}-description` : null,
    error && htmlFor ? `${htmlFor}-error` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="text-label text-foreground">
          {label}
          {required ? (
            <span className="text-destructive-subtle-foreground" aria-hidden>
              {' '}
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {/* Expose the described-by ids on the child control if it accepts them. */}
      {describedBy
        ? React.isValidElement(children)
          ? React.cloneElement(children as React.ReactElement, {
              'aria-describedby': describedBy,
              'aria-invalid': error ? true : undefined,
            })
          : children
        : children}
      {description && !error ? (
        <p
          id={htmlFor ? `${htmlFor}-description` : undefined}
          className="text-caption text-muted-foreground"
        >
          {description}
        </p>
      ) : null}
      {error ? (
        <p
          id={htmlFor ? `${htmlFor}-error` : undefined}
          role="alert"
          className="text-caption text-destructive-subtle-foreground"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
