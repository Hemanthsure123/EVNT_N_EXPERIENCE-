'use client';

import * as React from 'react';
import { Crosshair, Loader2, MapPin } from 'lucide-react';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { POPULAR_CITIES, type City } from '@/lib/discovery/cities';
import { useLocationContext } from '@/lib/location/location-context';
import { useAuth } from '@/lib/auth/auth-provider';
import { cn } from '@/lib/utils/cn';

/**
 * The location ask, on a first visit.
 *
 * ── IT IS NOT A PERMISSION PROMPT, AND THAT DISTINCTION IS THE DESIGN ─────
 *
 * `navigator.geolocation` is never called by this component appearing. The
 * browser's own prompt is fired only when somebody presses "Use my location" —
 * so the sequence is always: we explain what it is for, they choose, THEN the
 * grant dialog. A site that triggers the OS prompt on load is the fastest
 * possible route to a permanent block, and a block cannot be undone by us; it
 * lives in browser settings the user has to go and find.
 *
 * Every path out is a real answer. Picking a city works fully — the whole
 * product is usable with a typed city and no grant at all — so the dialog is
 * never a wall in front of the site.
 *
 * ── WHEN IT APPEARS ───────────────────────────────────────────────────────
 *
 * After the page has painted, once, and never in front of onboarding. The
 * ordering matters: a signed-in newcomer is already being asked for their name
 * and photo, and stacking a second dialog on that is how somebody dismisses
 * both without reading either. So it WAITS for onboarding to be done, then
 * takes its turn.
 *
 * It renders nothing at all when there is nothing to ask — a city is known, or
 * the ask was closed before. `dismiss()` is sticky and per-device, so "not now"
 * means not again rather than not this page.
 *
 * ── AND IT DELAYS ─────────────────────────────────────────────────────────
 *
 * `APPEAR_DELAY_MS` after mount. A modal that is present in the first frame is
 * an interstitial: it arrives before the visitor has seen anything worth
 * granting a permission FOR, and it competes with the LCP element for the same
 * moment of attention. A few seconds in, they have seen the showcase and the
 * question has a reason behind it.
 */

const APPEAR_DELAY_MS = 2500;

export function LocationPrompt() {
  const { city, status, precision, ready, dismissed, detect, setCity, dismiss } =
    useLocationContext();
  const { status: authStatus, user } = useAuth();
  const [elapsed, setElapsed] = React.useState(false);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setElapsed(true), APPEAR_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // Onboarding owns the screen until it is finished. `authStatus` is
  // 'authenticated' with an unfinished profile exactly while that dialog is up.
  const onboardingOpen = authStatus === 'authenticated' && !user?.onboarding_completed_at;

  const locating = status === 'locating';
  // A grant that produced a city closes this. A grant that FAILED does not —
  // the dialog stays and switches to the city list, because "we could not find
  // you" with no way forward is where a location ask usually strands somebody.
  const open = ready && !city && !dismissed && elapsed && !onboardingOpen;

  const failure =
    status === 'denied'
      ? 'Location is blocked for this site. You can still pick a city below.'
      : status === 'unserved'
        ? 'We have nothing near you yet — pick a city to browse.'
        : status === 'unsupported'
          ? 'This browser cannot share a location. Pick a city below.'
          : status === 'unavailable'
            ? 'We could not get a fix. Pick a city below.'
            : null;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        // Closing by any route — Escape, the scrim, the X — is the same answer
        // as "Not now", and is remembered. A dialog that returns on the next
        // page load has not been dismissed, it has been postponed, and that is
        // what makes people block the permission outright.
        if (!next) dismiss();
      }}
    >
      <ModalContent className="sm:max-w-md">
        <ModalHeader>
          <span
            className="mb-1 inline-flex size-11 items-center justify-center rounded-full bg-nav-active text-nav-active-foreground"
            aria-hidden
          >
            <MapPin className="size-5" />
          </span>
          <ModalTitle>Where are you?</ModalTitle>
          <ModalDescription>
            {failure ?? 'So we can show you what is on nearby, and put your city first.'}
          </ModalDescription>
        </ModalHeader>

        <div className="flex flex-col gap-stack-lg">
          {/* The detect path is the primary action only while it can still
              work. Once the browser has refused, offering it again is a button
              whose only outcome is the same refusal. */}
          {status !== 'denied' && status !== 'unsupported' ? (
            <button
              type="button"
              onClick={detect}
              disabled={locating}
              className={cn(
                'inline-flex h-control-lg w-full items-center justify-center gap-2 rounded-full bg-cta px-pill text-label text-cta-foreground shadow-sm',
                'transition-colors duration-fast hover:bg-cta-hover active:bg-cta-active disabled:opacity-70',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-elevated',
              )}
            >
              {locating ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Crosshair className="size-4" aria-hidden />
              )}
              {locating ? 'Finding you…' : 'Use my location'}
            </button>
          ) : null}

          <div className="flex flex-col gap-stack">
            <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
              Or pick a city
            </p>
            <ul className="flex flex-wrap gap-2">
              {POPULAR_CITIES.map((entry) => (
                <li key={entry.slug}>
                  <CityChip city={entry} onPick={setCity} />
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border pt-stack">
            <p className="text-caption text-muted-foreground">
              {precision === 'approximate'
                ? 'We keep the city only, never your coordinates.'
                : 'Only the city name is stored, on this device.'}
            </p>
            <button
              type="button"
              onClick={dismiss}
              className="shrink-0 rounded-full px-3 py-2 text-label text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Not now
            </button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  );
}

function CityChip({ city, onPick }: { city: City; onPick: (city: City) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(city)}
      className={cn(
        'inline-flex h-control items-center rounded-full border border-border bg-surface px-4 text-label text-foreground',
        'transition-colors duration-fast hover:border-border-strong hover:bg-muted',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-elevated',
      )}
    >
      {city.name}
    </button>
  );
}
