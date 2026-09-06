import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventQuestion } from '@/lib/api/event-content';
import { answersFor, clearAnswers, setAnswer, unansweredRequired } from './answers';

/**
 * The questionnaire's client-side store.
 *
 * It is a CONVENIENCE, never the gate — `create_booking` re-validates every
 * answer server-side. So the bar here is that it degrades safely: a private
 * window, a hand-edited value or a payload from an older build must never
 * crash a checkout, because the screen it would crash is the one holding
 * somebody's chosen tickets.
 */

function question(overrides: Partial<EventQuestion> & { id: string }): EventQuestion {
  return {
    prompt: 'Any dietary needs?',
    help_text: '',
    kind: 'short_text',
    choices: [],
    is_required: false,
    position: 0,
    ...overrides,
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('the store', () => {
  it('round-trips an answer', () => {
    setAnswer('evt-1', 'q1', 'Vegetarian');
    expect(answersFor('evt-1')).toEqual({ q1: 'Vegetarian' });
  });

  it('keeps events apart', () => {
    // Answering for one event must not leak into another — the store is one
    // key, so the scoping is the only thing preventing it.
    setAnswer('evt-1', 'q1', 'Vegetarian');
    setAnswer('evt-2', 'q1', 'Vegan');

    expect(answersFor('evt-1')).toEqual({ q1: 'Vegetarian' });
    expect(answersFor('evt-2')).toEqual({ q1: 'Vegan' });
  });

  it('clears one event without touching the others', () => {
    setAnswer('evt-1', 'q1', 'Vegetarian');
    setAnswer('evt-2', 'q1', 'Vegan');

    clearAnswers('evt-1');

    expect(answersFor('evt-1')).toEqual({});
    expect(answersFor('evt-2')).toEqual({ q1: 'Vegan' });
  });

  it('returns nothing for an event never answered', () => {
    expect(answersFor('evt-unknown')).toEqual({});
  });

  it('survives a hand-edited or half-written value', () => {
    window.sessionStorage.setItem('ee-booking-answers', 'not json at all');
    expect(answersFor('evt-1')).toEqual({});

    window.sessionStorage.setItem('ee-booking-answers', '[]');
    expect(answersFor('evt-1')).toEqual({});
  });

  it('drops a stored value that is not a string', () => {
    // It would reach `createBooking` and be refused by the serializer with a
    // message about the wrong field, on the money path.
    window.sessionStorage.setItem('ee-booking-answers', '{"evt-1":{"q1":42,"q2":"fine"}}');
    expect(answersFor('evt-1')).toEqual({ q2: 'fine' });
  });

  it('degrades rather than throwing when storage refuses', () => {
    // A private window with site data blocked. Losing draft answers is
    // recoverable; taking the checkout down is not.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(answersFor('evt-1')).toEqual({});

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => setAnswer('evt-1', 'q1', 'x')).not.toThrow();
  });
});

describe('unansweredRequired', () => {
  it('ignores optional questions entirely', () => {
    const questions = [question({ id: 'q1' }), question({ id: 'q2' })];
    expect(unansweredRequired(questions, {})).toEqual([]);
  });

  it('names every required question with no answer', () => {
    const questions = [
      question({ id: 'q1', is_required: true }),
      question({ id: 'q2', is_required: true }),
      question({ id: 'q3' }),
    ];

    expect(unansweredRequired(questions, { q1: 'Vegetarian' }).map((q) => q.id)).toEqual(['q2']);
  });

  it('treats a blank string as UNANSWERED', () => {
    // Mirrors the server exactly. A field somebody tabbed through is not an
    // answer, and storing `""` would make the organiser's export claim they
    // had replied.
    const questions = [question({ id: 'q1', is_required: true })];

    expect(unansweredRequired(questions, { q1: '' })).toHaveLength(1);
    expect(unansweredRequired(questions, { q1: '   ' })).toHaveLength(1);
    expect(unansweredRequired(questions, { q1: ' Vegetarian ' })).toHaveLength(0);
  });

  it('is empty for an event that asks nothing', () => {
    expect(unansweredRequired([], {})).toEqual([]);
  });
});
