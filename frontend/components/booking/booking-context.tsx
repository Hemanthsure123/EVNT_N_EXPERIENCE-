'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { fetchEventTiers } from '@/lib/api/events';
import type { Booking, EventDetail, TicketTier } from '@/lib/api/types';
import {
  SELECTION_PARAM,
  type Selection,
  type SelectionTotals,
  parseSelection,
  serialiseSelection,
  setQuantity as setQuantityIn,
  totalsFor,
} from '@/lib/booking/selection';
import { type StepId, currentStep } from '@/lib/booking/steps';

/**
 * One source of truth for the whole funnel.
 *
 * Four screens read the same three things — the event, what's been chosen, and
 * the booking once it exists — so they live here rather than being re-derived
 * per page. That's what lets the summary card keep its identity across steps
 * instead of being rebuilt (and re-animated from scratch) on each navigation.
 *
 * THE SELECTION IS THE URL. `setSelection` rewrites the query string with
 * `replaceState`, which keeps a chosen basket shareable and refresh-proof
 * without adding a history entry per quantity tap — twenty taps on a stepper
 * should not cost twenty presses of Back.
 *
 * INVENTORY IS NEVER CACHED, same rule as the event page: seeded from the
 * server's `no-store` read, then re-verified in the browser and re-checked when
 * the tab regains focus. Someone can sit on the ticket picker for ten minutes;
 * the numbers they're choosing against have to still be true when they press
 * Continue, and the backend re-checks under a row lock regardless.
 */

type BookingContextValue = {
  event: EventDetail;
  tiers: TicketTier[];
  tiersLoading: boolean;
  selection: Selection;
  totals: SelectionTotals;
  /** Takes an updater, like `setState` — see `liveSelection` for why. */
  setQuantity: (tierId: string, update: (current: number) => number) => void;
  clearSelection: () => void;
  /** The created booking, once the review step has reserved inventory. */
  booking: Booking | null;
  setBooking: (booking: Booking | null) => void;
  /** The public Razorpay key that came back with the order; '' when unset. */
  paymentKeyId: string;
  setPaymentKeyId: (key: string) => void;
  /**
   * Which provider created the order — `'razorpay'` or `'fake'`, as the server
   * named it; '' before the booking exists.
   *
   * Carried separately from the key because they answer different questions,
   * and treating an empty key as "no real provider" is precisely the bug that
   * put a live Pay button in front of a fake order id. See
   * lib/booking/payment-provider.ts.
   */
  paymentProvider: string;
  setPaymentProvider: (provider: string) => void;
  step: StepId;
  /**
   * False on the first screen of a session, true after any step change.
   *
   * Entrance animations key off this. An element that starts at `opacity: 0` is
   * NOT eligible to be the Largest Contentful Paint, so fading the first step in
   * made the whole page's content ineligible until hydration finished — LCP
   * measured 4.9s on a throttled profile for content that had actually painted
   * at 1.7s. Transitions belong BETWEEN steps, not on arrival.
   */
  hasNavigated: boolean;
  /** The current query string, so links between steps keep the basket. */
  query: string;
};

const BookingContext = React.createContext<BookingContextValue | null>(null);

const TIERS_REFRESH_MS = 60_000;

export function BookingProvider({
  event,
  initialTiers,
  children,
}: {
  event: EventDetail;
  initialTiers: TicketTier[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const searchParams = useSearchParams();

  const tiersQuery = useQuery({
    queryKey: ['event-tiers', event.id],
    queryFn: () => fetchEventTiers(event.id),
    initialData: { data: initialTiers },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: TIERS_REFRESH_MS,
  });
  // Memoised, because the `?? []` fallback would otherwise be a fresh array on
  // every render and invalidate every memo downstream — including the one that
  // keeps the ticket cards from re-rendering on each quantity tap.
  const tiers = React.useMemo(() => tiersQuery.data?.data ?? [], [tiersQuery.data]);

  const selection = React.useMemo(
    () => parseSelection(searchParams?.get(SELECTION_PARAM)),
    [searchParams],
  );

  const [booking, setBooking] = React.useState<Booking | null>(null);
  const [paymentKeyId, setPaymentKeyId] = React.useState('');
  const [paymentProvider, setPaymentProvider] = React.useState('');

  const step = currentStep(pathname);
  const firstStep = React.useRef(step);
  const [hasNavigated, setHasNavigated] = React.useState(false);
  React.useEffect(() => {
    if (step !== firstStep.current) setHasNavigated(true);
  }, [step]);

  /**
   * The selection as the URL has it RIGHT NOW, not as of the last render.
   *
   * `selection` above comes from `useSearchParams`, which only updates once
   * React re-renders — so two taps on "+" inside one frame would both read
   * quantity 0 and both write 1, and the second tap would vanish. Writes read
   * the address bar (which `replaceState` below updates synchronously); renders
   * keep using `selection`.
   */
  const liveSelection = React.useCallback(
    () => parseSelection(new URLSearchParams(window.location.search).get(SELECTION_PARAM)),
    [],
  );

  const writeSelection = React.useCallback(
    (next: Selection) => {
      const params = new URLSearchParams(window.location.search);
      const encoded = serialiseSelection(next);
      if (encoded) params.set(SELECTION_PARAM, encoded);
      else params.delete(SELECTION_PARAM);
      const query = params.toString();
      window.history.replaceState(null, '', query ? `${pathname}?${query}` : pathname);
      // `replaceState` alone doesn't tell Next's router the params changed, so
      // nothing re-renders. `refresh()` would round-trip the server; instead the
      // provider re-reads on the next render, which `router.replace` triggers
      // with `scroll: false` so the page doesn't jump on every tap.
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const setQuantity = React.useCallback(
    (tierId: string, update: (current: number) => number) => {
      const current = liveSelection();
      const existing = current.find((line) => line.tierId === tierId)?.quantity ?? 0;
      writeSelection(setQuantityIn(current, tierId, update(existing)));
    },
    [liveSelection, writeSelection],
  );

  const clearSelection = React.useCallback(() => writeSelection([]), [writeSelection]);

  const totals = React.useMemo(() => totalsFor(selection, tiers), [selection, tiers]);

  const value = React.useMemo<BookingContextValue>(
    () => ({
      event,
      tiers,
      tiersLoading: tiersQuery.isPending,
      selection,
      totals,
      setQuantity,
      clearSelection,
      booking,
      setBooking,
      paymentKeyId,
      setPaymentKeyId,
      paymentProvider,
      setPaymentProvider,
      step,
      hasNavigated,
      query: searchParams?.toString() ?? '',
    }),
    [
      event,
      tiers,
      tiersQuery.isPending,
      selection,
      totals,
      setQuantity,
      clearSelection,
      booking,
      paymentKeyId,
      paymentProvider,
      step,
      hasNavigated,
      searchParams,
    ],
  );

  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>;
}

export function useBooking(): BookingContextValue {
  const value = React.useContext(BookingContext);
  if (!value) throw new Error('useBooking must be used inside <BookingProvider>');
  return value;
}
