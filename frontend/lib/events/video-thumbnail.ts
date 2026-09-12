/**
 * The still to draw behind a play badge, derived from the embed URL.
 *
 * ── WHY DERIVED AND NOT STORED ────────────────────────────────────────────
 *
 * `EventMedia` stores one thing for a video: the canonical embed URL the
 * backend built from its host allow-list (`core.video_embeds`). There is no
 * thumbnail column, and adding one would mean asking organisers to upload a
 * still for a video they have already published somewhere that made one.
 *
 * YouTube's thumbnail URL is deterministic from the video id and has been for
 * fifteen years, so it is safe to build. Vimeo's is NOT — it needs an oEmbed
 * call per video, which is a network round trip on the hottest public route
 * for a decorative image. So Vimeo returns null and the tile draws its own
 * gradient, which is a deliberate state rather than a guess that 404s.
 *
 * `hqdefault` rather than `maxresdefault`: maxres exists only for videos
 * uploaded above 720p and 404s silently for the rest, which would make the
 * fallback fire for exactly the smaller organisers most likely to need it.
 * hqdefault is generated for every video without exception.
 */

/** `i.ytimg.com` — must also be in `next.config.mjs`'s `remotePatterns`, or
 *  `next/image` refuses it and the tile renders nothing at all. */
const YOUTUBE_STILL = 'https://i.ytimg.com/vi';

/**
 * Returns a still URL, or null when the provider cannot give one cheaply.
 *
 * Takes the EMBED url — the normalised one the backend stores, never a link an
 * organiser pasted — so the id is always in the same position and this needs
 * no parsing of the many shapes `core.video_embeds` already collapsed.
 */
export function videoThumbnail(embedUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(embedUrl);
  } catch {
    // A malformed URL is a tile with a gradient, never a thrown error on a
    // page render.
    return null;
  }

  if (!/(^|\.)youtube-nocookie\.com$|(^|\.)youtube\.com$/.test(parsed.hostname)) return null;

  // `/embed/{id}` is the only shape the backend stores for YouTube.
  const id = parsed.pathname.replace(/^\/embed\//, '').split('/')[0];
  // The id charset YouTube uses. Anything else is not an id, and building a
  // URL out of it would put arbitrary path segments in an image src.
  if (!id || !/^[A-Za-z0-9_-]{5,20}$/.test(id)) return null;

  return `${YOUTUBE_STILL}/${id}/hqdefault.jpg`;
}
