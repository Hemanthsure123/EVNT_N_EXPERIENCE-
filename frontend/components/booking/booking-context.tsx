'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { fetchEventTiers } from '@/lib/api/events';
import type { Booking, EventDetail, TicketTier } from '@/lib/api/types';
import type { EventQuestion, EventSlot } from '@/lib/api/event-content';
import { answersFor, setAnswer, unansweredRequired } from '@/lib/booking/answers';
import {
  defaultSession,
  groupSessions,
  tiersForSession,
  type Session,
  type SessionDay,
} from '@/lib/event/sessions';
import {
  SELECTION_PARAM,
  SESSION_PARAM,
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
  /**
   * The selection signature `booking` was reserved FOR — `''` when unknown
   * (a booking adopted from elsewhere, e.g. the confirmation screen's poll).
   *
   * ── WHY THIS IS HELD BESIDE THE BOOKING RATHER THAN DERIVED ─────────────
   *
   * The review screen has to answer one question every render: "is the hold I
   * am about to charge for the order the URL is describing?" It used to answer
   * it by comparing `booking.items` to the selection — and `POST /bookings`
   * returned the SUMMARY serializer, which carries no items, so the comparison
   * silently evaluated false and the screen rendered a mismatch. Measured on
   * the live site: line items followed the current selection while the fee and
   * the total followed the PREVIOUS one, one step behind on every quantity
   * change.
   *
   * The endpoint returns its items now, but a guard that depends on the shape
   * of a payload is a guard that a serializer change can switch off again
   * without anything failing. This is the signature the client itself sent,
   * recorded at the moment it sent it, so the comparison cannot be defeated by
   * what comes back.
   *
   * It is ONE piece of state with the booking (see `reservation` below), not a
   * second `useState`, because two setters is exactly how a booking and its
   * signature drift apart.
   */
  reservedFor: string;
  setBooking: (booking: Booking | null, reservedFor?: string) => void;
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

  // ── SESSIONS ────────────────────────────────────────────────────────────
  /** Grouped by day, empty for the single-show events that are most of them. */
  sessionDays: SessionDay[];
  /** The chosen showtime, or `null` when the event runs once. */
  session: Session | null;
  /**
   * Choose a showtime. CLEARS THE SELECTION, because the previous session's
   * tier ids do not exist in the new one — and `totalsFor` silently drops a
   * tier id it cannot resolve, so a stale basket would quietly empty rather
   * than error.
   */
  setSession: (session: Session) => void;
  /** The tiers belonging to the chosen session — what the picker renders. */
  sessionTiers: TicketTier[];

  // ── THE QUESTIONNAIRE ───────────────────────────────────────────────────
  /** What the organiser asks before somebody books. Empty for most events. */
  questions: EventQuestion[];
  /** The answers held for this checkout, as `{question_id: answer}`. */
  answers: Record<string, string>;
  /** Record one answer. Persisted per event so it survives the navigation. */
  answerQuestion: (questionId: string, answer: string) => void;
  /**
   * The REQUIRED questions still unanswered. Non-empty blocks Checkout — the
   * server refuses the reserve anyway, and finding that out on the screen
   * after the one holding the form is a dead end.
   */
  unanswered: EventQuestion[];
};

const BookingContext = React.createContext<BookingContextValue | null>(null);

const TIERS_REFRESH_MS = 60_000;

export function BookingProvider({
  event,
  initialTiers,
  slots = [],
  questions = [],
  children,
}: {
  event: EventDetail;
  initialTiers: TicketTier[];
  slots?: EventSlot[];
  questions?: EventQuestion[];
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

  /**
   * The hold and what it was reserved for, as ONE value.
   *
   * A hold exists only while the review screen is open — the picker cancels any
   * it finds on arrival, because holding stock while somebody is still choosing
   * tiers is precisely what this funnel reserves late to avoid.
   */
  const [reservation, setReservation] = React.useState<{
    booking: Booking | null;
    reservedFor: string;
  }>({ booking: null, reservedFor: '' });
  const booking = reservation.booking;
  const reservedFor = reservation.reservedFor;
  const setBooking = React.useCallback((next: Booking | null, forSelection = '') => {
    setReservation({ booking: next, reservedFor: next ? forSelection : '' });
  }, []);
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

  // ── THE CHOSEN SHOWTIME ────────────────────────────────────────────────
  //
  // A SEPARATE URL PARAM, never a field on `Selection`, and the reason is the
  // money path. `selectionSignature` feeds `idempotencyKeyFor` and is compared
  // against `bookingItemsSignature`, which is built from server items that can
  // never carry a slot — so a session inside the selection would make every
  // live reservation compare as STALE, which the review screen answers by
  // cancelling and re-reserving. This is the same split the date filters make
  // between a named window and a chosen range.
  const sessionDays = React.useMemo(() => groupSessions(slots, tiers), [slots, tiers]);

  const session = React.useMemo(() => {
    if (!sessionDays.length) return null;
    const requested = searchParams?.get(SESSION_PARAM);
    const all = sessionDays.flatMap((day) => day.sessions);
    // An unknown id falls back to the default rather than 404ing the screen:
    // these arrive in links people share, and a retired showtime should show
    // the next one rather than an empty checkout.
    return all.find((candidate) => candidate.slot.id === requested) ?? defaultSession(sessionDays);
  }, [sessionDays, searchParams]);

  const setSession = React.useCallback(
    (next: Session) => {
      const params = new URLSearchParams(window.location.search);
      params.set(SESSION_PARAM, next.slot.id);
      // The previous session's tiers do not exist in this one, so the basket
      // cannot survive the switch. Dropped here rather than left to
      // `totalsFor`, which silently ignores a tier id it cannot resolve — the
      // failure would be a basket that quietly empties on the way to pay.
      params.delete(SELECTION_PARAM);
      const query = params.toString();
      window.history.replaceState(null, '', query ? `${pathname}?${query}` : pathname);
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  // ── THE QUESTIONNAIRE ─────────────────────────────────────────────────
  //
  // Held in `sessionStorage` rather than the URL: a dietary requirement is
  // free text with commas and newlines in it, and the selection's own encoding
  // is a comma/colon scheme that would have to grow escaping. Read into state
  // AFTER mount, because the server has no `sessionStorage` and reading during
  // render is a hydration mismatch.
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    setAnswers(answersFor(event.id));
  }, [event.id]);

  const answerQuestion = React.useCallback(
    (questionId: string, answer: string) => {
      setAnswer(event.id, questionId, answer);
      setAnswers((current) => ({ ...current, [questionId]: answer }));
    },
    [event.id],
  );

  const unanswered = React.useMemo(
    () => unansweredRequired(questions, answers),
    [questions, answers],
  );

  // What the picker renders. For a single-show event this is every tier, which
  // is exactly the behaviour the funnel had before sessions were wired up.
  const sessionTiers = React.useMemo(
    () => (session ? tiersForSession(tiers, session.slot.id) : tiers),
    [session, tiers],
  );

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
      reservedFor,
      setBooking,
      paymentKeyId,
      setPaymentKeyId,
      paymentProvider,
      setPaymentProvider,
      step,
      hasNavigated,
      query: searchParams?.toString() ?? '',
      sessionDays,
      session,
      setSession,
      sessionTiers,
      questions,
      answers,
      answerQuestion,
      unanswered,
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
      reservedFor,
      setBooking,
      paymentKeyId,
      paymentProvider,
      step,
      hasNavigated,
      searchParams,
      sessionDays,
      session,
      setSession,
      sessionTiers,
      questions,
      answers,
      answerQuestion,
      unanswered,
    ],
  );

  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>;
}

export function useBooking(): BookingContextValue {
  const value = React.useContext(BookingContext);
  if (!value) throw new Error('useBooking must be used inside <BookingProvider>');
  return value;
}
