import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EMPTY_FILTERS } from '@/lib/discovery/filters';
import { ResultsEmpty } from './results-empty';
import { RowError } from './row-states';

/**
 * "You're offline" and "something went wrong" are DIFFERENT PROBLEMS WITH
 * DIFFERENT FIXES, and the same rejected fetch produces both. This is the test
 * that keeps them apart.
 *
 * The failure it guards against is not cosmetic. Telling somebody on a train
 * that our platform is broken points them at a fix they cannot make, and sends
 * them to a status page, to support, or away — and thirty seconds later their
 * signal is back and a working site has just called itself broken.
 */

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
}

afterEach(() => setOnline(true));

describe('RowError', () => {
  it('blames the network, not the platform, when the reader is offline', () => {
    setOnline(false);
    render(<RowError message="HTTP 500 from /events" retryHref="/events" />);

    expect(screen.getByText(/you[’']re offline/i)).toBeVisible();
    // The server's message describes an HTTP failure. Offline, it is both
    // wrong and unreadable, so it must not survive into the copy.
    expect(screen.queryByText(/HTTP 500/)).toBeNull();
    // A way out is still offered — it is what works the moment signal returns,
    // and a screen with no control on it reads as a dead end rather than a wait.
    expect(screen.getByRole('link', { name: /try again/i })).toBeVisible();
  });

  it('reports the real failure when the connection is fine', () => {
    render(<RowError message="Couldn't reach the events API." retryHref="/events" />);

    expect(screen.getByText(/couldn't load this row/i)).toBeVisible();
    expect(screen.getByText(/couldn't reach the events api/i)).toBeVisible();
    expect(screen.queryByText(/you[’']re offline/i)).toBeNull();
  });
});

describe('ResultsEmpty', () => {
  it('does not blame the filters for a missing connection', () => {
    setOnline(false);
    render(<ResultsEmpty filters={{ ...EMPTY_FILTERS, city: 'Mumbai' }} onChange={() => {}} />);

    expect(screen.getByText(/you[’']re offline/i)).toBeVisible();
    expect(screen.queryByText(/nothing matched/i)).toBeNull();

    // EVERY control on the normal panel fires a fetch — the suspect-filter
    // button, "Start over", the category and city chips, the popular searches.
    // Offering eleven things to press that each fail is worse than offering
    // none, so the offline branch replaces the panel rather than decorating it.
    expect(screen.queryByRole('button', { name: /start over/i })).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('offers a retry only when the caller actually has one', () => {
    setOnline(false);
    const { rerender } = render(<ResultsEmpty filters={EMPTY_FILTERS} onChange={() => {}} />);
    // No `onRetry` -> no button. Deliberately NOT a `location.reload()`
    // fallback: reloading while offline replaces a page that still has content
    // on it with the browser's own network error page.
    expect(screen.queryByRole('button')).toBeNull();

    rerender(<ResultsEmpty filters={EMPTY_FILTERS} onChange={() => {}} onRetry={() => {}} />);
    expect(screen.getByRole('button', { name: /try again/i })).toBeVisible();
  });

  it('still explains the filters when the connection is fine', () => {
    render(<ResultsEmpty filters={{ ...EMPTY_FILTERS, city: 'Mumbai' }} onChange={() => {}} />);

    expect(screen.getByText(/nothing matched all of that/i)).toBeVisible();
    expect(screen.queryByText(/you[’']re offline/i)).toBeNull();
  });
});
