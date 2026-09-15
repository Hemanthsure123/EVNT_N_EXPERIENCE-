import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PRESS_WINDOW_MS,
  VIEW_TTL_MS,
  armEngagement,
  flushEngagement,
  recordImpression,
  recordView,
  rememberPress,
  resetEngagementForTests,
  takeBeacon,
  viewSource,
} from './engagement';

/**
 * The browser half of views, impressions and click-through.
 *
 * What is pinned is the dedupe the server relies on the browser for — one
 * impression per card per page load, one view per event per tab per half hour
 * — plus the two properties a counter must never lose: it counts nothing
 * outside the public site, and it sends nothing about who is looking.
 */

beforeEach(() => {
  resetEngagementForTests();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('nothing is counted until the public site arms it', () => {
  it('ignores impressions and views while disarmed', () => {
    // The organizer dashboard renders event components too, and an organizer
    // previewing their own draft is not an audience.
    recordImpression('e1');
    recordView('e1');
    expect(takeBeacon()).toBeNull();
  });

  it('stops counting when the tracker unmounts', () => {
    const disarm = armEngagement();
    disarm();
    recordImpression('e1');
    expect(takeBeacon()).toBeNull();
  });

  it('a remount cannot be disarmed by the tracker it replaced', () => {
    const first = armEngagement();
    armEngagement();
    first();
    recordImpression('e1');
    expect(takeBeacon()?.impressions).toEqual(['e1']);
  });
});

describe('an impression', () => {
  it('is counted once per card per page load', () => {
    armEngagement();
    recordImpression('e1');
    recordImpression('e1');
    recordImpression('e2');
    expect(takeBeacon()?.impressions).toEqual(['e1', 'e2']);
    recordImpression('e1');
    expect(takeBeacon()).toBeNull();
  });
});

describe('a view', () => {
  it('is not counted again for a reload inside the window', () => {
    armEngagement();
    recordView('e1', 1_000);
    expect(takeBeacon()?.views).toEqual([{ event_id: 'e1', source: 'direct' }]);
    recordView('e1', 1_000 + VIEW_TTL_MS - 1);
    expect(takeBeacon()).toBeNull();
    recordView('e1', 1_000 + VIEW_TTL_MS + 1);
    expect(takeBeacon()?.views).toHaveLength(1);
  });

  it('is a feed view when it follows a press on that event’s card', () => {
    armEngagement();
    rememberPress('e1', 5_000);
    recordView('e1', 7_000);
    expect(takeBeacon()?.views).toEqual([{ event_id: 'e1', source: 'feed' }]);
  });

  it('is direct when the press was on another card, or too long ago', () => {
    expect(viewSource({ id: 'e2', at: 0 }, 'e1', 10)).toBe('direct');
    expect(viewSource({ id: 'e1', at: 0 }, 'e1', PRESS_WINDOW_MS + 1)).toBe('direct');
    expect(viewSource(null, 'e1', 0)).toBe('direct');
    expect(viewSource({ id: 'e1', at: 0 }, 'e1', PRESS_WINDOW_MS)).toBe('feed');
  });
});

describe('the beacon', () => {
  it('carries the city the header shows, and nothing when none is chosen', () => {
    armEngagement();
    recordImpression('e1');
    window.localStorage.setItem('ee-city', 'Mumbai');
    expect(takeBeacon()?.city).toBe('Mumbai');

    recordImpression('e2');
    window.localStorage.removeItem('ee-city');
    expect(takeBeacon()?.city).toBeNull();
  });

  it('is sent without credentials, and with keepalive as the page is left', () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);
    armEngagement();
    recordImpression('e1');

    flushEngagement({ keepalive: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/events\/engagement$/);
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    // No account, no token: nothing about who is looking leaves the page.
    expect(init.credentials).toBe('omit');
    expect(JSON.parse(init.body as string)).toEqual({
      impressions: ['e1'],
      views: [],
      city: null,
    });
  });

  it('sends nothing when nothing is queued', () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);
    armEngagement();
    flushEngagement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('splits a busy page across beacons rather than exceeding the server’s bound', () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);
    armEngagement();
    for (let index = 0; index < 150; index += 1) recordImpression(`e${index}`);
    flushEngagement();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
