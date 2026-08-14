'use client';

import * as React from 'react';

/**
 * An image from the storage adapter, which degrades instead of breaking.
 *
 * ── WHY NOT `next/image` ──────────────────────────────────────────────────
 *
 * Every caller here renders a URL produced by a CONFIGURABLE storage backend —
 * Supabase, R2, B2, MinIO or S3, chosen by an env var at deploy time. That is
 * not a host `next.config.mjs` can be given at build time, which is the same
 * reason each of these call sites already carried an eslint exemption.
 *
 * ── WHY IT EXISTS AT ALL ──────────────────────────────────────────────────
 *
 * A bare `<img>` whose object is missing paints the browser's broken-image
 * glyph: a torn page icon and the alt text, in the middle of a layout that was
 * expecting a photograph. Readers do not interpret that as "one file is gone".
 * They read it as the page being broken — and on a performer's gallery or an
 * organizer's cover preview, that is a judgement about the product rather than
 * about one row.
 *
 * There are ordinary reasons a stored URL stops resolving: an object deleted
 * from the bucket, a backend swapped between environments, a signed URL past
 * its expiry, a half-finished upload. None of them mean the surrounding screen
 * failed, so none of them should look like it did.
 *
 * ── THE FAILURE IS TRACKED BY URL, NOT AS A BOOLEAN ───────────────────────
 *
 * A boolean latches for the life of the component, so replacing a broken photo
 * would keep showing the placeholder and make a successful re-upload look like
 * it failed too. Remembering WHICH url failed lets the next one be tried.
 */
export function RemoteImage({
  src,
  alt = '',
  className,
  fallback = null,
  loading = 'lazy',
}: {
  src: string | null | undefined;
  /**
   * Empty by default. Correct for a photo sitting beside a name that already
   * identifies it — announcing it twice is noise for a screen reader. Callers
   * whose image carries meaning of its own pass real text.
   */
  alt?: string;
  className?: string;
  /** Drawn when there is no url, or when the url fails. */
  fallback?: React.ReactNode;
  loading?: 'lazy' | 'eager';
}) {
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);

  if (!src || failedSrc === src) return <>{fallback}</>;

  return (
    /* eslint-disable-next-line @next/next/no-img-element -- see the note above:
       a configurable storage host cannot be declared at build time. */
    <img
      src={src}
      alt={alt}
      loading={loading}
      onError={() => setFailedSrc(src)}
      className={className}
    />
  );
}
