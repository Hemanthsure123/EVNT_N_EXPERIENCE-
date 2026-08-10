import { afterEach, describe, expect, it, vi } from 'vitest';
import { EVENT_IMAGE, EVENT_IMAGE_HINT, checkImageFile } from './event-content';

/**
 * The client half of the upload gate.
 *
 * It decides nothing — the server refuses independently — so what is worth
 * testing is that it does not refuse things the server would ACCEPT, and does
 * not stay silent about the one shape organisers actually upload by mistake.
 */

function file(name = 'art.png', type = 'image/png', bytes = 2048) {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** Stand in for the browser's decoder at a chosen size. */
function decodesAs(width: number, height: number) {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn().mockResolvedValue({ width, height, close: vi.fn() }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('checkImageFile', () => {
  it('accepts the recommended 1920x1080 export', async () => {
    decodesAs(EVENT_IMAGE.recommendedWidth, EVENT_IMAGE.recommendedHeight);
    expect(await checkImageFile(file())).toBeNull();
  });

  it('accepts both ends of the band, so it never refuses what the server allows', async () => {
    decodesAs(3000, 2000); // 3:2, a camera
    expect(await checkImageFile(file())).toBeNull();
    decodesAs(2160, 1080); // 2:1, Eventbrite's banner
    expect(await checkImageFile(file())).toBeNull();
  });

  it('names the shape and the fix for a portrait poster', async () => {
    decodesAs(1200, 1800);
    const problem = await checkImageFile(file('poster.png'));
    expect(problem).toContain('taller than it is wide');
    expect(problem).toContain('1920 x 1080');
    // Shape before size, like the server: this file fails both, and telling
    // somebody to enlarge a poster sends them back with a bigger poster.
    expect(problem).not.toContain('too small');
  });

  it('refuses a correctly shaped image below the resolution floor', async () => {
    decodesAs(640, 360);
    expect(await checkImageFile(file())).toContain('too small');
  });

  it('still refuses on type and size before it ever decodes', async () => {
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    expect(await checkImageFile(file('doc.pdf', 'application/pdf'))).toContain(
      'not a supported image',
    );
    expect(decode).not.toHaveBeenCalled();
  });

  it('lets a file through when the browser cannot measure it', async () => {
    // The server is authoritative. Refusing an upload the browser merely
    // failed to decode would block a file that is actually fine — the one
    // failure mode a convenience check must not have.
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockRejectedValue(new Error('unsupported')),
    );
    vi.stubGlobal(
      'Image',
      class {
        onerror: (() => void) | null = null;
        set src(_value: string) {
          setTimeout(() => this.onerror?.(), 0);
        }
      },
    );
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() });
    expect(await checkImageFile(file())).toBeNull();
  });
});

describe('EVENT_IMAGE_HINT', () => {
  it('states the numbers it is mirroring, so the copy cannot drift from the rule', () => {
    expect(EVENT_IMAGE_HINT).toContain(String(EVENT_IMAGE.recommendedWidth));
    expect(EVENT_IMAGE_HINT).toContain(String(EVENT_IMAGE.minWidth));
  });
});
