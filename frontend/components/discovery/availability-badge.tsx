import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import type { AvailabilityBadge as AvailabilityBadgeData } from '@/lib/discovery/availability';
import { cn } from '@/lib/utils/cn';

/**
 * The scarcity badge.
 *
 * The visible label is deliberately terse ("Few left"); the screen-reader label
 * carries the number ("Only 3 tickets left"). When the two are identical there's
 * no second copy in the DOM at all — a duplicated string that a screen reader
 * skips is still one more thing to get out of sync.
 */
export function AvailabilityBadge({
  badge,
  className,
}: {
  badge: AvailabilityBadgeData;
  className?: string;
}) {
  const needsSrLabel = badge.srLabel !== badge.label;
  return (
    <Badge variant={badge.variant} className={cn(className)}>
      {needsSrLabel ? <span className="sr-only">{badge.srLabel}</span> : null}
      <span aria-hidden={needsSrLabel || undefined}>{badge.label}</span>
    </Badge>
  );
}
