import { describe, expect, it } from 'vitest';
import { videoThumbnail } from './video-thumbnail';

/**
 * The still behind a play badge. Two things make this worth testing: it builds
 * a URL from a string, and the string reaches it from a database row.
 */
describe('videoThumbnail', () => {
  it('derives the still for the embed url the backend stores', () => {
    // `core.video_embeds` normalises every YouTube link — youtu.be, a Short, a
    // watch url — to exactly this shape, which is why nothing here parses the
    // many forms an organiser might paste.
    expect(videoThumbnail('https://www.youtube-nocookie.com/embed/0safa-gtIgQ')).toBe(
      'https://i.ytimg.com/vi/0safa-gtIgQ/hqdefault.jpg',
    );
  });

  it('uses hqdefault, which exists for every video', () => {
    // `maxresdefault` is generated only above 720p and 404s silently for the
    // rest — so it would fail for exactly the smaller organisers whose events
    // most need the thumbnail.
    expect(videoThumbnail('https://www.youtube.com/embed/abcdefghijk')).toContain('hqdefault');
  });

  it('returns null for Vimeo rather than guessing', () => {
    // Vimeo's still needs an oEmbed round trip per video. A network call for a
    // decorative image on the hottest public route is not worth it, and a
    // guessed URL would 404. The tile draws its own gradient instead.
    expect(videoThumbnail('https://player.vimeo.com/video/123456')).toBeNull();
  });

  it('refuses a host that is not YouTube', () => {
    // The result goes straight into an `<img src>`. Nothing that is not a
    // known provider gets to decide what that loads.
    expect(videoThumbnail('https://evil.example/embed/x')).toBeNull();
    expect(videoThumbnail('https://notyoutube.com/embed/x')).toBeNull();
  });

  it('refuses an id that is not an id', () => {
    // Path traversal into an image URL. `/embed/../../foo` must not become a
    // request for something else on the CDN.
    expect(videoThumbnail('https://www.youtube-nocookie.com/embed/../../evil')).toBeNull();
    expect(videoThumbnail('https://www.youtube-nocookie.com/embed/')).toBeNull();
  });

  it('survives a malformed url', () => {
    // A row written before the allow-list existed must not throw during a
    // render.
    expect(videoThumbnail('not a url')).toBeNull();
    expect(videoThumbnail('')).toBeNull();
  });
});
