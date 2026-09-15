'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';

/**
 * "YOU ARE LEAVING THE ORGANIZER DASHBOARD."
 *
 * The dashboard now renders attendee content — the landing page at
 * `/dashboard/home`, an event's public page behind "View public page", the
 * deck's Book tickets — and every one of those links leads into the ATTENDEE
 * shell. Following one silently swaps the whole chrome: the organizer's header
 * and bottom bar vanish and the four-tab public bar takes their place, which
 * reads as the app having thrown them out. This asks first.
 *
 * ── ONE LISTENER, NOT A WRAPPER AROUND EVERY LINK ───────────────────────
 *
 * The links live in shared discovery components that know nothing about
 * dashboards, and will be joined by more. Wrapping each one would mean every
 * future card remembering to opt in. So this listens once, at the document,
 * in the CAPTURE phase — which runs before React's own handlers, so a
 * `stopPropagation` here stops Next's `<Link>` from starting the navigation at
 * all rather than racing it.
 *
 * ── WHAT IT LETS THROUGH, AND WHY EACH ───────────────────────────────────
 *
 * - Anything under an operator surface (`/dashboard`, `/admin`, `/studio`):
 *   that is not "customer view".
 * - Modifier and middle clicks, and `target="_blank"`: opening a new tab does
 *   not leave the dashboard, and hijacking an explicit "open elsewhere" is
 *   hostile.
 * - Other origins, `mailto:`, `tel:` and downloads: not a route change here.
 * - The mobile event deck: its cards are BUTTONS, not anchors, so tapping one
 *   opens the deck in place and never reaches this listener.
 *
 * ── THE LIMIT ────────────────────────────────────────────────────────────
 *
 * It sees CLICKS ON ANCHORS. A navigation started by `router.push` from a
 * button bypasses it — there is no App Router API for blocking a navigation.
 * Every public destination reachable from the dashboard today is an anchor,
 * and a test asserts the ones that matter are caught.
 */

/** Path prefixes that are part of an operator product, not the customer view. */
const OPERATOR_PREFIXES = ['/dashboard', '/admin', '/studio'] as const;

/**
 * Where a click is headed, if and only if that is the customer view.
 *
 * Pure, and exported for the test: every rule about which links count lives
 * here rather than inside an event listener where it can only be exercised by
 * dispatching real clicks.
 */
export function customerViewDestination(href: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.origin !== origin) return null;

  const path = url.pathname;
  const operator = OPERATOR_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
  if (operator) return null;

  return `${url.pathname}${url.search}${url.hash}`;
}

export function LeaveDashboardGuard() {
  const router = useRouter();
  const [destination, setDestination] = React.useState<string | null>(null);

  React.useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const origin = event.target instanceof Element ? event.target : null;
      const anchor = origin?.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;

      const next = customerViewDestination(anchor.href, window.location.origin);
      if (!next) return;

      // BOTH, and in the capture phase: `preventDefault` stops the browser's
      // own navigation, `stopPropagation` stops the event reaching React, so
      // Next's `<Link>` never calls `router.push` behind the dialog.
      event.preventDefault();
      event.stopPropagation();
      setDestination(next);
    };

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  const close = () => setDestination(null);

  return (
    <Modal open={destination !== null} onOpenChange={(open) => (open ? null : close())}>
      <ModalContent className="gap-stack-lg sm:max-w-md">
        <ModalHeader className="items-center gap-stack text-center">
          {/* The picture of the thing that is about to happen — one product
              handing over to the other. Decorative; the title says it. */}
          <span
            aria-hidden
            className="inline-flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <ArrowLeftRight className="size-6" />
          </span>
          <ModalTitle>Switch to customer view?</ModalTitle>
          <ModalDescription>
            You are leaving the Organizer Dashboard. Switch to Customer View for a smooth
            experience?
          </ModalDescription>
        </ModalHeader>

        <ModalFooter className="gap-2 sm:justify-center">
          {/* Staying is the safe choice and is offered first; switching is
              what the press was for, so it carries the fill. */}
          <Button variant="outline" onClick={close} className="sm:min-w-32">
            Cancel
          </Button>
          <Button
            onClick={() => {
              const target = destination;
              close();
              // `router.push`, never a synthetic click: a click would come
              // straight back through the listener above and reopen this.
              if (target) router.push(target);
            }}
            className="sm:min-w-32"
          >
            Switch view
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
