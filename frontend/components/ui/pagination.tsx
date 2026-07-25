import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { Button } from './button';

export interface PaginationProps {
  hasPrevious?: boolean;
  hasNext?: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  /** Optional context label, e.g. "Page 2" or "21–40 of 128". */
  label?: React.ReactNode;
  className?: string;
}

/** Cursor-style pagination (matches the backend's Prev/Next cursor lists).
 * Buttons disable at the ends; the whole control is a labelled nav landmark. */
export function Pagination({
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  label,
  className,
}: PaginationProps) {
  return (
    <nav
      aria-label="Pagination"
      className={cn('flex items-center justify-between gap-3', className)}
    >
      <Button
        variant="outline"
        size="sm"
        onClick={onPrevious}
        disabled={!hasPrevious}
        leftIcon={<ChevronLeft className="size-4" aria-hidden />}
      >
        Previous
      </Button>
      {label ? <span className="text-body-sm text-muted-foreground">{label}</span> : null}
      <Button
        variant="outline"
        size="sm"
        onClick={onNext}
        disabled={!hasNext}
        rightIcon={<ChevronRight className="size-4" aria-hidden />}
      >
        Next
      </Button>
    </nav>
  );
}
