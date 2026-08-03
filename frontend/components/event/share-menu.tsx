'use client';

import * as React from 'react';
import { Check, Facebook, Link2, Mail, MessageCircle, Share2, Twitter } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils/cn';

/**
 * Share, with the native sheet first and a real fallback behind it.
 *
 * The native sheet is always the better answer where it exists: it already
 * knows which apps this person uses, and it doesn't put third-party buttons on
 * the page. So it's tried first, and the menu only appears where
 * `navigator.share` is missing — which today is most desktop browsers.
 *
 * The fallback links are plain `https://` share URLs. No SDKs, no embedded
 * scripts, no pixels: nothing here loads anything from those companies, which
 * is the difference between offering to share and letting them watch.
 *
 * `navigator.share` rejects with `AbortError` when the user dismisses the sheet.
 * That's a completed interaction, not a failure, so it must not fall through to
 * opening the menu — a dismissed sheet followed by a popped-open menu feels
 * like the app didn't believe you.
 */

export function ShareMenu({
  title,
  path,
  className,
}: {
  title: string;
  /** App-relative, e.g. `/events/123` — resolved against the live origin. */
  path: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [url, setUrl] = React.useState('');

  React.useEffect(() => {
    setUrl(new URL(path, window.location.origin).toString());
  }, [path]);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const onTrigger = async (event: React.MouseEvent) => {
    if (typeof navigator === 'undefined' || !navigator.share) return; // let the popover open
    event.preventDefault();
    try {
      await navigator.share({ title, url });
    } catch {
      // Dismissed, or the sheet refused. Either way, don't second-guess it.
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const encoded = encodeURIComponent(url);
  const text = encodeURIComponent(title);
  const links = [
    { label: 'WhatsApp', icon: MessageCircle, href: `https://wa.me/?text=${text}%20${encoded}` },
    { label: 'X', icon: Twitter, href: `https://x.com/intent/tweet?text=${text}&url=${encoded}` },
    {
      label: 'Facebook',
      icon: Facebook,
      href: `https://www.facebook.com/sharer/sharer.php?u=${encoded}`,
    },
    { label: 'Email', icon: Mail, href: `mailto:?subject=${text}&body=${encoded}` },
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        onClick={onTrigger}
        aria-label={`Share ${title}`}
        className={cn(
          // A secondary action: hairline pill, never a fill. `h-control` is the
          // 44px touch floor, shared with every other pill on this page.
          'inline-flex h-control items-center gap-2 rounded-full border border-input bg-surface px-pill text-label text-foreground',
          'transition-colors duration-fast hover:bg-muted',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          className,
        )}
      >
        <Share2 className="size-4" aria-hidden />
        Share
      </PopoverTrigger>

      <PopoverContent align="end" className="w-56">
        <button
          type="button"
          onClick={() => void copy()}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-body-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copied ? (
            <Check className="size-4 shrink-0 text-success-subtle-foreground" aria-hidden />
          ) : (
            <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          {copied ? 'Link copied' : 'Copy link'}
        </button>

        {links.map((link) => (
          <a
            key={link.label}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-body-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <link.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {link.label}
          </a>
        ))}
      </PopoverContent>
    </Popover>
  );
}
