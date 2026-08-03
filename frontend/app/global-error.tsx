'use client';

import * as React from 'react';
import { ErrorScreen, useLoggedError } from '@/components/illustrations/error-screen';
import { SceneError } from '@/components/illustrations/scenes';
import { themeInitScript } from '@/lib/theme/theme-provider';
import '@/styles/globals.css';

/**
 * The LAST-RESORT boundary: the root layout itself threw.
 *
 * ── WHY IT RENDERS ITS OWN DOCUMENT ──────────────────────────────────────
 *
 * This is the only boundary above `app/layout.tsx`, so when it runs there is no
 * <html>, no <body>, no providers and no stylesheet — the layout that would
 * have produced them is what failed. Next requires it to supply the document
 * itself, and that is also why it imports the global stylesheet directly rather
 * than inheriting it.
 *
 * ── WHY IT DUPLICATES THE THEME SCRIPT AND FAKES THE FONT VARIABLES ──────
 *
 * Two things the root layout normally provides have to be re-provided here, and
 * neither is optional:
 *
 * 1. THE THEME. Without the pre-hydration script, a reader in dark mode gets a
 *    full-screen white page at the exact moment the product has already let
 *    them down. It is the same one-line inline script the root layout runs.
 * 2. THE FONT VARIABLES. `--font-sans` is minted by `next/font` in the root
 *    layout. With it undefined, `body { font-family: var(--font-sans),
 *    system-ui, sans-serif }` is invalid at computed-value time — which does
 *    NOT fall through to `system-ui`, it falls all the way back to the
 *    browser's default serif. So the last-resort page would render in Times New
 *    Roman, which reads as a broken server rather than as a handled error.
 *    They are pointed at system fonts rather than re-imported: `next/font` in a
 *    Client Component (which this file must be) is a constraint this page
 *    should not be the one to discover, and a system stack is the honest choice
 *    for a screen that renders when the app's own pipeline has failed.
 *
 * ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────
 *
 * No query client, no auth provider, no header. Anything this page depends on
 * is one more thing that can be the reason it cannot render, and there is
 * nothing below it to catch that.
 */

/** System stacks, so an undefined `--font-sans` can never resolve to serif. */
const SYSTEM_FONTS = {
  '--font-sans': 'system-ui',
  '--font-display': 'system-ui',
  '--font-mono': 'ui-monospace',
} as React.CSSProperties;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useLoggedError(error);

  return (
    <html lang="en" style={SYSTEM_FONTS} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-dvh bg-background font-sans text-body text-foreground antialiased">
        <ErrorScreen
          scene={<SceneError className="h-40 w-auto sm:h-48" />}
          title="This page didn't load"
          // Deliberately vaguer than the other boundaries: when the root layout
          // is the thing that broke, we genuinely do not know which part of the
          // app is at fault, and guessing would be a worse answer than not
          // guessing.
          message="Something went wrong before the page could start. Reloading usually fixes it."
          onRetry={reset}
          retryLabel="Reload"
          digest={error.digest}
        />
      </body>
    </html>
  );
}
