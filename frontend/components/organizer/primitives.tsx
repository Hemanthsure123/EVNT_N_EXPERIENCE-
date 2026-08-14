'use client';

import * as React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { SceneNothingYet } from '@/components/illustrations/scenes';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

/**
 * The four states every panel on this dashboard has to render, and the
 * small pieces of chrome they share.
 *
 * LOADING, EMPTY and ERROR are three different things and are drawn three
 * different ways — the mistake the operator console made once was rendering a
 * failed request as an empty chart, which reads as "you earned nothing" rather
 * than "the query broke". On a revenue dashboard that is the difference
 * between a calm morning and a panicked one.
 *
 * ── THE LIGHT-FIRST RECIPE ────────────────────────────────────────────────
 *
 * On a pure-white canvas `bg-surface` is the SAME value as the page, so a card
 * cannot separate by colour: it separates with `border-border` + `shadow-sm`,
 * which is the recipe styles/tokens.css documents. In dark the ladder does the
 * work and the shadow is invisible — the same two classes are correct in both
 * themes, which is why they are written once here rather than per caller.
 *
 * Padding comes from `p-card` / `px-card`, never an ad-hoc `p-4`, so every
 * panel on every screen of this portal indents its content by the same amount.
 */

export function Panel({
  id,
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  /** A scroll anchor, so a sibling pane can bring this section into view. */
  id?: string;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn('rounded-xl border border-border bg-surface shadow-sm', className)}
    >
      {title ? (
        <header className="flex items-center gap-stack border-b border-border px-card py-stack">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-body-sm font-semibold text-foreground">{title}</h2>
            {subtitle ? (
              <p className="truncate text-caption text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** A shimmering block of the right SHAPE — never a spinner for a whole page. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} aria-hidden />;
}

export function ErrorState({
  message = 'That request failed.',
  onRetry,
  className,
}: {
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('flex flex-col items-start gap-stack p-card', className)}>
      {/* `text-destructive`, not the subtle-tint pairing: this sits on a plain
          surface, and the subtle foreground is calibrated against its own
          tint. 4.83:1 on white, 6.09:1 on the dark surface rung. */}
      <p className="flex items-start gap-2 text-body-sm text-destructive">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {/* Says the request failed — never renders as "0", which would be a
            claim about the business rather than about the network. */}
        {message}
      </p>
      {onRetry ? (
        // `md`, not `sm`: retry is the only thing to do on this panel and it
        // has to be hittable with a thumb at the gate. Outline, because the
        // screen's one filled action lives in the top bar.
        <Button
          variant="outline"
          size="md"
          onClick={onRetry}
          leftIcon={<RefreshCw className="size-4" />}
        >
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon: Icon,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
  /**
   * A SUBJECT hint, not a replacement for the illustration.
   *
   * This prop used to swap the scene out for a 20px lucide glyph in a grey
   * square, and its docstring claimed "every one of the thirty callers omits
   * it". That stopped being true: about two dozen callers now pass one, so
   * the drawn empty state had silently disappeared from the entire organizer
   * dashboard and admin console — including empty tickets and empty saved
   * lists — and every one of them showed the same grey circle.
   *
   * Both are worth keeping: the scene carries the tone, the icon says which
   * list is empty. So the icon is now a small badge ON the scene rather than
   * instead of it, and no caller had to change.
   */
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    // Deliberately tighter than the consumer site's empty states. This is a
    // working screen: the scene says "nothing here yet" without spending half
    // a viewport saying it, so the next panel stays above the fold.
    <div className="flex flex-col items-center gap-stack px-card py-block-lg text-center">
      {/* "Nothing here yet" rather than "nothing matched": these are lists
          waiting to be filled, not searches that failed, and the two scenes
          are drawn differently on purpose. */}
      <span className="relative inline-flex" aria-hidden>
        <SceneNothingYet className="h-20" />
        {Icon ? (
          // Sits on the scene's lower-right, on a surface chip so it reads as
          // a label on the picture rather than a shape floating in it.
          <span className="absolute -bottom-1 -right-1 inline-flex size-7 items-center justify-center rounded-full border border-border bg-surface shadow-sm">
            <Icon className="size-3.5 text-muted-foreground" />
          </span>
        ) : null}
      </span>
      <p className="text-body font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-body-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

/**
 * A status badge with a fixed colour per state.
 *
 * The mapping is exhaustive over what the backend can actually return, and
 * every colour comes from the semantic token scale — no status invents a hue.
 * `selling fast` and `sold out` are DERIVED (from remaining stock), not stored,
 * and are marked as such here so nobody later goes looking for the column.
 *
 * `info` is the SEMANTIC BLUE now. It used to be `bg-secondary`, which after
 * the light-first shift is a neutral ink tint one step from `bg-muted` — so
 * "Pending approval" and "Draft" were all but the same swatch in a status
 * column somebody scans a hundred rows of. Five tones, five distinguishable
 * hues, and the two neutral-looking ones are the two that genuinely mean
 * "nothing is happening here".
 */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-info-subtle text-info-subtle-foreground',
  success: 'bg-success-subtle text-success-subtle-foreground',
  warning: 'bg-warning-subtle text-warning-subtle-foreground',
  danger: 'bg-destructive-subtle text-destructive-subtle-foreground',
};

export function StatusPill({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-caption font-medium',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** `null` renders as an em dash. A rate with no denominator is not 0%. */
export function Percent({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) {
    return (
      <span className="text-muted-foreground" title="Not enough data yet">
        —
      </span>
    );
  }
  return <>{value}%</>;
}

/**
 * An event poster that degrades to its empty frame instead of to a broken icon.
 *
 * `<img src={url}>` with no error handling paints the browser's broken-image
 * glyph whenever the URL 404s — which happens for real reasons here: a poster
 * uploaded before the storage backend moved, an object removed from the bucket,
 * or a `NEXT_PUBLIC_MEDIA_BASE_URL` that does not match the host actually
 * serving the file. The row is not broken; one image is missing, and the two
 * should not look the same.
 *
 * The failure is tracked BY URL rather than as a boolean, so a row whose poster
 * is replaced retries the new one. A boolean would latch the placeholder for
 * the life of the component and make a successful re-upload look like it failed.
 */
export function Poster({
  url,
  className,
  fallback = null,
}: {
  url: string | null | undefined;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const [failedUrl, setFailedUrl] = React.useState<string | null>(null);

  if (!url || failedUrl === url) return <>{fallback}</>;

  return (
    /* eslint-disable-next-line @next/next/no-img-element -- a configurable
       storage adapter's URL, not a host next/image can be told about at build
       time. */
    <img
      src={url}
      alt=""
      loading="lazy"
      onError={() => setFailedUrl(url)}
      className={className}
    />
  );
}
