/* eslint-disable local-rules/no-raw-values, @next/next/no-img-element */
import * as React from 'react';
import { BRAND_NAME } from '@/lib/brand';
import { cn } from '@/lib/utils/cn';

/**
 * The Curatix mark — a ticket stub with a location pin marker.
 */
export function BrandMark({
  className,
  title = BRAND_NAME,
}: {
  className?: string;
  /** Empty string marks it decorative, for use beside a visible wordmark. */
  title?: string;
}) {
  const id = React.useId();
  const gradId = `curatix-mark-grad-${id.replace(/:/g, '')}`;

  return (
    <svg
      viewBox="0 0 44 32"
      role={title ? 'img' : 'presentation'}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      className={cn('h-7 w-auto shrink-0', className)}
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1B5BFF" />
          <stop offset="100%" stopColor="#9B1BFF" />
        </linearGradient>
      </defs>

      {/* Ticket Body Stub */}
      <path
        d="M 14,2
           C 6,2 2,8 2,16
           C 2,24 6,30 14,30
           L 36,30
           C 36,28.5 37,27.5 38,27.5
           C 39,27.5 40,28.5 40,30
           L 42,30
           C 42,24 38,21 38,16
           C 38,11 42,8 42,2
           L 40,2
           C 40,3.5 39,4.5 38,4.5
           C 37,4.5 36,3.5 36,2
           Z"
        fill={`url(#${gradId})`}
      />

      {/* Perforation Dots */}
      <circle cx="34" cy="8" r="1.1" fill="#FFFFFF" opacity="0.95" />
      <circle cx="34" cy="13.3" r="1.1" fill="#FFFFFF" opacity="0.95" />
      <circle cx="34" cy="18.6" r="1.1" fill="#FFFFFF" opacity="0.95" />
      <circle cx="34" cy="24" r="1.1" fill="#FFFFFF" opacity="0.95" />

      {/* Location Pin inside Ticket */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M 16,7.5
           C 11.3,7.5 7.5,11.3 7.5,16
           C 7.5,20.5 11.5,24.5 16,28.5
           C 20.5,24.5 24.5,20.5 24.5,16
           C 24.5,11.3 20.7,7.5 16,7.5
           Z
           M 16,13.5
           A 2.5,2.5 0 1,0 16,18.5
           A 2.5,2.5 0 1,0 16,13.5
           Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

/**
 * Mark plus wordmark — renders the official Curatix logo assets:
 * Light mode: /curatix-logo.png
 * Dark mode: /curatix-logo-dark.png
 *
 * ── THE SIZE, AND WHAT BOUNDS IT ──────────────────────────────────────────
 *
 * `h-10` (40px), up from `h-7` (28px): the lockup read as small beside the
 * 44px account avatar it shares every header row with, and a wordmark that has
 * to carry the brand at 28px on a phone is carrying it at the size of body
 * copy.
 *
 * 40px is the ceiling, not a preference. The header is `--header-height` 64px
 * and its brand link adds `py-1`, so the lockup occupies 48 of those 64 —
 * comfortable. `h-12` (48px) would occupy 56 and leave 4px of clearance top
 * and bottom, which is not a margin, it is a rounding error; the row would
 * look wrong the first time anything gained a border.
 *
 * `w-auto` throughout, so the aspect ratio is the asset's and never this
 * file's opinion, and `shrink-0` on the wrapper so a long city name in the
 * next grid column squeezes itself rather than the logo.
 */
export function BrandLockup({
  className,
  collapsed = false,
}: {
  className?: string;
  collapsed?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5 shrink-0', className)}>
      <img
        src="/curatix-logo.png"
        alt={BRAND_NAME}
        className={cn('h-10 w-auto object-contain dark:hidden', collapsed && 'h-8')}
      />
      <img
        src="/curatix-logo-dark.png"
        alt={BRAND_NAME}
        className={cn('hidden h-10 w-auto object-contain dark:block', collapsed && 'h-8')}
      />
    </span>
  );
}
