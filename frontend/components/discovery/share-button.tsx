'use client';

import * as React from 'react';
import { Check, Share2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * Share, as a client island inside a server-rendered banner.
 *
 * Uses the native share sheet where it exists (every mobile browser, and
 * increasingly desktop), and falls back to copying the link — which is what
 * people do by hand anyway. It never renders a row of network-specific buttons:
 * those are third-party trackers wearing a UI, and the share sheet already
 * knows which apps this person actually uses.
 *
 * The confirmation is inline and self-clearing, so sharing needs no toast.
 */
export function ShareButton({
  title,
  path,
  className,
}: {
  title: string;
  /** App-relative, e.g. `/events/123` — resolved against the live origin. */
  path: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const onShare = async (event: React.MouseEvent) => {
    // The banner is a link; sharing is not navigation.
    event.preventDefault();
    event.stopPropagation();
    const url = new URL(path, window.location.origin).toString();
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // A dismissed share sheet rejects — that's a normal outcome, not an error.
    }
  };

  return (
    <button
      type="button"
      onClick={onShare}
      aria-label={copied ? 'Link copied' : `Share ${title}`}
      className={cn(
        'glass-media inline-flex size-9 items-center justify-center rounded-full border text-on-gradient',
        'transition duration-fast ease-out hover:scale-[1.06] active:scale-95',
        'motion-reduce:hover:scale-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
    >
      {copied ? (
        <Check className="size-4 text-success-subtle-foreground" aria-hidden />
      ) : (
        <Share2 className="size-4" aria-hidden />
      )}
    </button>
  );
}
