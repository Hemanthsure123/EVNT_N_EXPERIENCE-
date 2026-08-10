import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { API_BASE_URL } from './config';

/**
 * Every upload must be sent to the API, not to whatever origin served the page.
 *
 * ── THE BUG THIS EXISTS TO CATCH ──────────────────────────────────────────
 *
 * `uploadMedia` opened `POST /api/v1/events/{id}/media/upload` — a RELATIVE
 * path. A relative URL resolves against the page's origin, which in
 * development is the Next server on :3000, not the API on :8000. Next has no
 * such route, so it answered with its own 404 HTML page; the JSON parse threw,
 * and the error fell back to a generic "That upload did not go through."
 *
 * Every gallery and cover upload failed, and the message named no cause.
 *
 * ── WHY THIS TEST AND NOT A COMPONENT TEST ────────────────────────────────
 *
 * The bug is invisible to every test that mocks the network, and invisible to
 * `tsc` and `eslint` — a relative URL is a perfectly valid string. It is only
 * observable at the moment `XMLHttpRequest.open` is called, so that is exactly
 * what is asserted: the URL these functions hand the browser.
 *
 * The two upload paths are checked TOGETHER on purpose. `uploadAvatar` always
 * had the base URL and `uploadMedia` did not — two functions, the same shape,
 * disagreeing, with only one of them exercised by anybody. Testing them side
 * by side is what makes the next one impossible to add wrong.
 */

class FakeXhr {
  static opened: { method: string; url: string }[] = [];
  upload = { addEventListener: vi.fn() };
  addEventListener = vi.fn();
  setRequestHeader = vi.fn();
  open(method: string, url: string) {
    FakeXhr.opened.push({ method, url });
  }
  send = vi.fn();
  abort = vi.fn();
  status = 200;
  responseText = '{}';
}

beforeEach(() => {
  FakeXhr.opened = [];
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function pngFile() {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'poster.png', { type: 'image/png' });
}

describe('upload URLs', () => {
  it('sends event media to the API origin, not the page origin', async () => {
    const { uploadMedia } = await import('./event-content');

    uploadMedia('evt-1', { file: pngFile(), kind: 'gallery', altText: 'A crowd' });

    expect(FakeXhr.opened).toHaveLength(1);
    const { url } = FakeXhr.opened[0];
    expect(url.startsWith(API_BASE_URL)).toBe(true);
    expect(url).toContain('/api/v1/events/evt-1/media/upload');
  });

  it('sends the avatar to the API origin', async () => {
    const { uploadAvatar } = await import('./profile');

    uploadAvatar(pngFile());

    expect(FakeXhr.opened).toHaveLength(1);
    expect(FakeXhr.opened[0].url.startsWith(API_BASE_URL)).toBe(true);
  });

  it('never opens a relative URL', async () => {
    // The general rule, stated once. A relative URL here is always a bug, and
    // is always silent — it produces a 404 from whichever server happens to be
    // serving the page rather than an error naming the mistake.
    const { uploadMedia } = await import('./event-content');
    const { uploadAvatar } = await import('./profile');

    uploadMedia('evt-2', { file: pngFile(), kind: 'hero', altText: 'Stage' });
    uploadAvatar(pngFile());

    for (const { url } of FakeXhr.opened) {
      expect(url, `${url} is relative — it would resolve against the page origin`).toMatch(
        /^https?:\/\//,
      );
    }
  });
});
