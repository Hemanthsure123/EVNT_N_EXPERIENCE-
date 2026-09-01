'use client';

import * as React from 'react';
import type { User } from '@/lib/api/types';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer';
import { AuthPanel } from './auth-panel';

/**
 * Signing in without leaving what you were doing.
 *
 * ── WHY A SHEET AND NOT A STEP ────────────────────────────────────────────
 *
 * The booking funnel used to send an anonymous visitor to `/booking/{id}/login`
 * — a whole screen, a whole navigation, and a progress bar that counted signing
 * in as a quarter of buying a ticket. Coming back meant re-entering the funnel
 * and hoping the selection had survived the round trip.
 *
 * A sheet keeps the screen underneath: the tickets are still chosen, still on
 * screen behind the scrim, and the moment the session exists the flow continues
 * from exactly where it paused. Signing in stops being a detour and becomes an
 * interruption you answer.
 *
 * ── IT IS THE SAME PANEL AS EVERYWHERE ELSE ───────────────────────────────
 *
 * `AuthPanel` is rendered verbatim — the same component the standalone
 * `/sign-in` route uses. Two copies of an auth form is how the two drift, and
 * this one sits in front of a payment: whatever the panel knows about
 * suspended accounts, unverified addresses, Google availability and which
 * methods are actually connected, this knows too, because it IS that.
 *
 * That is also why there is no hand-built phone field here. The panel offers
 * phone entry when `NEXT_PUBLIC_PHONE_AUTH_ENABLED` says the backend can
 * answer it, and says plainly that it is not connected when it cannot. A
 * mobile-number box that silently fails is the worst control to fake on the
 * screen before a payment, because a ticket and a charge are attributed to
 * whoever the session claims you are.
 *
 * ── THE SHEET ITSELF ──────────────────────────────────────────────────────
 *
 * `Drawer` with `side="responsive"`: a bottom sheet on a phone, a side panel
 * from `lg`. It brings the opaque surface, the dimmed and blurred scrim, the
 * locked background, exactly one close control and the focus trap — so this is
 * not a second modal system, it is the one the rest of the mobile app uses.
 */
export function AuthSheet({
  open,
  onOpenChange,
  onAuthenticated,
  /** Where an OAuth round trip should come back to. */
  next,
  heading = 'Sign in to continue',
  subheading = 'Your tickets are held while you do. Nothing you have chosen is lost.',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAuthenticated: (user: User) => void;
  next: string;
  heading?: string;
  subheading?: string;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="responsive" aria-label={heading} bare>
        <div className="flex min-h-0 flex-1 flex-col">
          <header className="flex shrink-0 flex-col gap-stack border-b border-border px-6 pb-card pt-card-lg">
            <DrawerTitle>{heading}</DrawerTitle>
            <DrawerDescription>{subheading}</DrawerDescription>
          </header>

          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-card-lg"
            // Safe-area aware: on a phone with a gesture bar the last 34px
            // belong to the system, and a Continue button underneath it is a
            // form with no way to submit.
            style={{ paddingBottom: 'calc(var(--space-card-lg) + env(safe-area-inset-bottom))' }}
          >
            {/* No `heading`/`subheading` passed through: the sheet's own header
                already carries them, and the panel repeating them would be the
                same two sentences twice on one small screen. */}
            <AuthPanel onAuthenticated={onAuthenticated} next={next} />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
