import type { EventQuestion } from '@/lib/api/event-content';

/**
 * The organiser's questionnaire, held between the picker and the reserve.
 *
 * ── WHY THIS NEEDS A STORE AT ALL ─────────────────────────────────────────
 *
 * The answers have to travel with `POST /bookings`, and that call fires on
 * MOUNT of the review screen — before anybody has had a chance to read it, let
 * alone type into it. So the questions are asked on the picker, one screen
 * earlier, and the answers have to survive a client-side navigation.
 *
 * They cannot ride in the URL. A dietary requirement is free text with commas,
 * newlines and apostrophes in it; the selection's own `tickets=` encoding is a
 * comma/colon scheme that would have to grow escaping, and a long answer would
 * push the URL past what some proxies keep. `sessionStorage` is the same seam
 * `ee-payment-failure` and `ee-booking-attempt` already use for exactly this
 * kind of one-checkout state.
 *
 * ── IT IS A CONVENIENCE, NEVER THE GATE ───────────────────────────────────
 *
 * `create_booking` re-validates every answer server-side: which questions the
 * event asks, which are required, and whether a blank counts. Nothing here is
 * trusted. If storage is unavailable — a private window, blocked site data —
 * the answers are simply lost and the server refuses the booking with a clear
 * message, which is the correct outcome rather than a silent half-booking.
 *
 * ── SCOPED PER EVENT, AND CLEARED ON SUCCESS ──────────────────────────────
 *
 * Keyed by event id so answering for one event cannot leak into another, and
 * dropped once the booking exists: the answers are on the server by then, and
 * leaving them would refill the form for a second, unrelated purchase.
 */

const KEY = 'ee-booking-answers';

type Store = Record<string, Record<string, string>>;

function read(): Store {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // A hand-edited or half-written value must not crash a checkout. Anything
    // that is not a plain object reads as "nothing stored".
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Store)
      : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Private mode, or quota. Losing the draft answers is recoverable — the
    // server will refuse the booking and say which question is unanswered.
  }
}

/** Every answer held for one event, as `{question_id: answer}`. */
export function answersFor(eventId: string): Record<string, string> {
  const stored = read()[eventId];
  if (!stored || typeof stored !== 'object') return {};
  // Coerce: a stored non-string would reach `createBooking` and be refused by
  // the serializer with a message about the wrong field.
  const clean: Record<string, string> = {};
  for (const [id, value] of Object.entries(stored)) {
    if (typeof value === 'string') clean[id] = value;
  }
  return clean;
}

/** Record one answer. An empty string is stored, and counts as unanswered. */
export function setAnswer(eventId: string, questionId: string, answer: string): void {
  const store = read();
  store[eventId] = { ...(store[eventId] ?? {}), [questionId]: answer };
  write(store);
}

/** Forget this event's answers — called once the booking exists. */
export function clearAnswers(eventId: string): void {
  const store = read();
  if (!(eventId in store)) return;
  delete store[eventId];
  write(store);
}

/**
 * Which REQUIRED questions still have no answer.
 *
 * Mirrors the server's rule exactly, including that a blank string is not an
 * answer: a field somebody tabbed through is not a response, and storing `""`
 * would make the organiser's export claim they had replied.
 *
 * Returns the questions themselves rather than a boolean so the caller can
 * name them — "2 questions still need an answer" is actionable where "the form
 * is incomplete" sends somebody hunting.
 */
export function unansweredRequired(
  questions: readonly EventQuestion[],
  answers: Record<string, string>,
): EventQuestion[] {
  return questions.filter(
    (question) => question.is_required && !(answers[question.id] ?? '').trim(),
  );
}
