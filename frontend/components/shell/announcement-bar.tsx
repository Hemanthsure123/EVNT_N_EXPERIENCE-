'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, Info, Megaphone, Sparkles, X } from 'lucide-react';
import type { AnnouncementKind, LiveAnnouncement } from '@/lib/api/cms';
import { cn } from '@/lib/utils/cn';
import { Container } from './container';

/**
 * The platform announcement bar.
 *
 * ── DISMISSAL IS PER-ANNOUNCEMENT AND PERSISTS ────────────────────────────
 *
 * Keyed by the announcement's id, not by a single "banner dismissed" flag —
 * otherwise closing a promotion would also suppress next month's maintenance
 * notice, which is the one an operator most needs people to read.
 *
 * ── AN EMERGENCY CANNOT BE DISMISSED ──────────────────────────────────────
 *
 * `dismissible` is a per-row decision the operator makes, and the close button
 * is simply absent when it is false. Rendering a disabled X would be worse
 * than none: it invites a click that does nothing.
 *
 * ── IT RENDERS FROM SERVER-SUPPLIED DATA, AND HIDES ITSELF UNTIL HYDRATED ─
 *
 * Dismissal state lives in `localStorage`, which the server cannot read. If
 * the bar rendered its final state on the server, an already-dismissed banner
 * would flash on every navigation. So the markup is present but the dismissed
 * set is applied after mount — and because the height is reserved by the bar
 * itself rather than by the page, nothing below it shifts.
 *
 * ── THE LINK IS ALWAYS SAME-ORIGIN ────────────────────────────────────────
 *
 * Enforced server-side (`AnnouncementService._check_link`), so `next/link` is
 * safe here. An operator-authored banner that could point anywhere would be a
 * phishing vector on the platform's own front page.
 *
 * ── ONLY THE SEMANTIC KINDS GET A SEMANTIC COLOUR ─────────────────────────
 *
 * `emergency` and `maintenance` keep destructive/warning tints: those two are
 * telling you something is wrong, and the colour IS the message. `feature` and
 * `promotion` were `bg-secondary`, which was a saturated violet-100 band with
 * violet-700 text sitting ABOVE the header — on a white, image-forward page
 * that made an operator's marketing note the single loudest element on screen,
 * which is precisely backwards. They are quiet now: a warm grey band for a
 * feature note, the same butter cream as the active nav pill for a promotion.
 *
 * ── IT SHARES THE HEADER'S GUTTERS ────────────────────────────────────────
 *
 * Via `Container`, not a hand-rolled `mx-auto max-w-container`. The hand-rolled
 * one was `px-4` at every width against the header's `px-4 lg:px-6`, so from lg
 * up the banner's text started 8px to the left of the brand directly beneath
 * it.
 */

const STORAGE_KEY = 'ee-dismissed-announcements';

const STYLES: Record<AnnouncementKind, { wrap: string; icon: typeof Info }> = {
  emergency: {
    wrap: 'bg-destructive-subtle text-destructive-subtle-foreground border-destructive-subtle',
    icon: AlertTriangle,
  },
  maintenance: {
    wrap: 'bg-warning-subtle text-warning-subtle-foreground border-warning-subtle',
    icon: Info,
  },
  feature: { wrap: 'bg-sunken text-foreground border-border', icon: Sparkles },
  promotion: {
    wrap: 'bg-nav-active text-nav-active-foreground border-nav-active-hover',
    icon: Megaphone,
  },
};

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function AnnouncementBar({ announcements }: { announcements: LiveAnnouncement[] }) {
  const [dismissed, setDismissed] = React.useState<string[]>([]);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    setDismissed(readDismissed());
    setReady(true);
  }, []);

  const dismiss = (id: string) => {
    const next = [...readDismissed(), id];
    setDismissed(next);
    try {
      // Bounded: an operator who publishes hundreds of banners over a year
      // should not grow this key without limit.
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(-50)));
    } catch {
      // Not being able to remember the dismissal is no reason to refuse it.
    }
  };

  // Before hydration nothing is known to be dismissed, so render nothing
  // rather than flash a banner the visitor already closed.
  const visible = ready ? announcements.filter((row) => !dismissed.includes(row.id)) : [];
  if (visible.length === 0) return null;

  return (
    <div role="region" aria-label="Platform announcements">
      {visible.map((row) => {
        const style = STYLES[row.kind] ?? STYLES.feature;
        return (
          <div
            key={row.id}
            className={cn('border-b py-2.5 text-body-sm', style.wrap)}
            // `assertive` only for an emergency — anything else interrupting a
            // screen reader mid-sentence is rude, not urgent.
            role={row.kind === 'emergency' ? 'alert' : 'status'}
          >
            <Container className="flex items-center gap-2.5">
              <style.icon className="size-4 shrink-0" aria-hidden />
              <p className="min-w-0 flex-1">
                <span className="font-semibold">{row.title}</span>
                {row.body ? <span className="ml-1.5">{row.body}</span> : null}
                {row.link_path && row.link_label ? (
                  <Link
                    href={row.link_path}
                    className="ml-2 whitespace-nowrap font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {row.link_label}
                  </Link>
                ) : null}
              </p>
              {row.dismissible ? (
                // 44px hit target without a 44px band: the negative margin lets
                // the button eat the strip's vertical padding instead of adding
                // to it, so the bar above the header stays thin.
                <button
                  type="button"
                  onClick={() => dismiss(row.id)}
                  aria-label={`Dismiss: ${row.title}`}
                  className="-my-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-colors duration-fast ease-out hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-4" aria-hidden />
                </button>
              ) : null}
            </Container>
          </div>
        );
      })}
    </div>
  );
}
