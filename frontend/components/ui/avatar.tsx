'use client';

import * as React from 'react';
import Image from 'next/image';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { initialsOf } from '@/lib/identity/initials';
import { cn } from '@/lib/utils/cn';

export const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(function Avatar({ className, ...props }, ref) {
  return (
    <AvatarPrimitive.Root
      ref={ref}
      className={cn(
        'relative flex size-10 shrink-0 overflow-hidden rounded-full bg-muted',
        className,
      )}
      {...props}
    />
  );
});

export const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(function AvatarImage({ className, ...props }, ref) {
  return (
    <AvatarPrimitive.Image
      ref={ref}
      className={cn('aspect-square size-full', className)}
      {...props}
    />
  );
});

export const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(function AvatarFallback({ className, ...props }, ref) {
  return (
    <AvatarPrimitive.Fallback
      ref={ref}
      className={cn(
        'flex size-full items-center justify-center bg-secondary text-label text-secondary-foreground',
        className,
      )}
      {...props}
    />
  );
});

/* -------------------------------------------------------------------------- */
/* IdentityAvatar — the one place a person or an organisation is drawn         */
/* -------------------------------------------------------------------------- */

/**
 * A picture when there is one, the initials treatment when there is not.
 *
 * ── ONE COMPONENT, EVERY SURFACE ──────────────────────────────────────────
 *
 * The header control, the account menu's identity card, the account overview
 * and the upload control all render THIS. They used to each own a `<span>` with
 * initials in it, which is how one of them keeps showing a stale picture after
 * an upload — and the header is the surface a user checks to confirm the upload
 * worked.
 *
 * ── WHY IT DOES NOT USE THE RADIX PRIMITIVE ABOVE ─────────────────────────
 *
 * `AvatarPrimitive.Image` renders a raw `<img>` and withholds it until its own
 * loader reports success. Neither fits: an avatar is a remote, user-uploaded
 * image, so it wants `next/image` (optimisation, the format negotiation, and
 * the `remotePatterns` allow-list that keeps arbitrary hosts out) — and that
 * cannot be composed into Radix's `<img>`. So the image renders immediately and
 * falls back only when it actually FAILS, which is the honest inversion: a
 * deleted storage object shows initials rather than a broken-image glyph.
 *
 * ── SHAPE CARRIES THE DISTINCTION, NOT COLOUR ─────────────────────────────
 *
 * A warm cream CIRCLE for a person, a neutral rounded TILE for an
 * organisation — the same language the account menu established, so the two are
 * told apart at a glance and not only by their label.
 *
 * ── DECORATIVE BY DEFAULT ─────────────────────────────────────────────────
 *
 * `aria-hidden`, because every place it renders already names the person next to
 * it or in the trigger's `aria-label`. An avatar that announces itself makes a
 * screen reader read the same name twice.
 */

export type IdentityAvatarSize = 'sm' | 'md' | 'lg' | 'xl';

/** Class + the pixel width `next/image` should size its source for. Kept
    together so the two can never disagree — a `sizes` that overstates the box
    downloads a needlessly large file for a 28px medallion. */
const SIZES: Record<IdentityAvatarSize, { box: string; px: number }> = {
  sm: { box: 'size-7 text-caption', px: 28 },
  md: { box: 'size-10 text-body-sm', px: 40 },
  lg: { box: 'size-14 text-h4', px: 56 },
  xl: { box: 'size-20 text-h3', px: 80 },
};

export function IdentityAvatar({
  /** A name or an email — whatever the initials should come from. */
  name,
  /** An absolute URL, or `''`/undefined for "no picture". */
  imageUrl,
  size = 'md',
  shape = 'circle',
  className,
}: {
  name: string;
  imageUrl?: string | null;
  size?: IdentityAvatarSize;
  shape?: 'circle' | 'tile';
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);

  // A NEW url deserves a fresh attempt: without this, one broken image would
  // stick the fallback on for the life of the component, so the picture a user
  // just uploaded to replace it would never appear.
  React.useEffect(() => setFailed(false), [imageUrl]);

  const { box, px } = SIZES[size];
  const showImage = Boolean(imageUrl) && !failed;

  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold',
        box,
        shape === 'tile'
          ? 'rounded-lg bg-secondary text-secondary-foreground'
          : 'rounded-full bg-nav-active text-nav-active-foreground',
        className,
      )}
    >
      {showImage ? (
        <Image
          src={imageUrl as string}
          alt=""
          fill
          sizes={`${px}px`}
          className="object-cover"
          // The fallback is the whole point: a storage object that was deleted,
          // or a host that is not on `remotePatterns`, shows initials rather
          // than a broken-image glyph in the header.
          onError={() => setFailed(true)}
        />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
