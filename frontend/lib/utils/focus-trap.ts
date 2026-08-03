'use client';

import * as React from 'react';

/**
 * What a `modal={false}` Radix overlay has to put back.
 *
 * Radix's modal mode is correct but expensive: it sets `pointer-events: none`
 * on `<body>` and injects a scroll-lock stylesheet, which invalidates style and
 * layout for the entire document. Measured on this app, opening an overlay cost
 * ~1.0s of processing at 4x CPU throttling — an order of magnitude over the
 * 200ms INP budget — and dropped to ~0.3s with `modal={false}`.
 *
 * `modal={false}` gives up three things. Two of them matter and are restored
 * here; the third is a deliberate trade:
 *
 *   1. **Focus trap** -> `trapTab` cycles Tab within the panel.
 *   2. **Background hidden from assistive tech** -> `useBackgroundInert`
 *      `aria-hidden`s the app shell while the overlay is open.
 *   3. **Background scroll lock** -> NOT restored. Scrolling the page behind an
 *      open panel is a minor oddity; a second of unresponsiveness on every open
 *      is not. Radix's own dismiss-on-outside-click still applies, so the panel
 *      closes the moment you interact with what's behind it.
 *
 * Both overlays on this site (the search palette and the filter panel) need
 * exactly this, which is why it lives here rather than in either of them.
 */

/** Everything that can hold focus inside an overlay. */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The app shell's id — the subtree hidden from AT while an overlay is open. */
export const SHELL_ID = 'site-shell';

/** Cycle Tab within `root`. Call from the overlay's `onKeyDown`. */
export function trapTab(event: React.KeyboardEvent, root: HTMLElement | null) {
  if (event.key !== 'Tab' || !root) return;
  const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last?.focus({ preventScroll: true });
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first?.focus({ preventScroll: true });
  }
}

/** Hide the page behind an open overlay from assistive technology. */
export function useBackgroundInert(open: boolean) {
  React.useEffect(() => {
    if (!open) return;
    const shell = document.getElementById(SHELL_ID);
    shell?.setAttribute('aria-hidden', 'true');
    return () => shell?.removeAttribute('aria-hidden');
  }, [open]);
}
