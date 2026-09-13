/**
 * Coordinates out of a pasted Google Maps link.
 *
 * ── WHY PARSE INSTEAD OF STORING THE URL ─────────────────────────────────
 *
 * The event page draws a map from `Event.latitude` / `longitude`, and every
 * consumer — the directions link, the venue card, the JSON-LD — reads those
 * two columns. Storing a URL beside them would be a SECOND source of truth for
 * where the event is, and the two would disagree the first time somebody moved
 * the pin. So a pasted link is an INPUT METHOD for the same pair of numbers,
 * not a different way of describing the place. That is also what makes the
 * pin/link choice genuinely exclusive: both write the same fields.
 *
 * ── THE SHAPES GOOGLE ACTUALLY EMITS ─────────────────────────────────────
 *
 * Share sheet, address bar and "copy link" all differ, and a real organizer
 * pastes whichever they have:
 *
 *   .../@12.9716,77.5946,17z/...           the viewport centre, in the path
 *   .../data=...!3d12.9716!4d77.5946       the PLACE, which is the better one
 *   ...?q=12.9716,77.5946                  a coordinate query
 *   ...?ll=12.9716,77.5946                 an older viewport parameter
 *   ...?destination=12.9716,77.5946        a directions link
 *
 * `!3d`/`!4d` wins where present: `@` is where the CAMERA was, which after a
 * scroll is not the pin. Everything else is tried in the order above.
 *
 * ── WHAT IT REFUSES ──────────────────────────────────────────────────────
 *
 * A short `maps.app.goo.gl` link carries no coordinates at all — it is a
 * redirect, and resolving it means a server-side fetch of a user-supplied URL,
 * which is an SSRF surface for a convenience. It returns null and the UI says
 * to paste the full link instead, which is one press in Google Maps.
 */
export type ParsedPin = { latitude: number; longitude: number };

/** Latitude is ±90, longitude is ±180. A transposed pair is the commonest
 *  paste error and lands in the sea, so both bounds are checked. */
function within(latitude: number, longitude: number): ParsedPin | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  // 0,0 is a real place in the Atlantic and never an event, so it is the one
  // coordinate pair treated as "nothing was parsed" — the same rule
  // `Event.latitude` already documents for its own null default.
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude };
}

const PATTERNS: RegExp[] = [
  // The PLACE, not the camera. Tried first for exactly that reason.
  /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
  /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
  /[?&](?:q|ll|sll|daddr|destination)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
];

export function parseMapsLink(raw: string): ParsedPin | null {
  const text = raw.trim();
  if (!text) return null;

  for (const pattern of PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      const found = within(Number(match[1]), Number(match[2]));
      if (found) return found;
    }
  }

  // A bare "12.9716, 77.5946" pasted from anywhere. Accepted because somebody
  // who has the numbers should not have to find a map to hand them over — but
  // only when that is the WHOLE input, so a stray pair inside a URL that
  // failed every pattern above is not mistaken for the answer.
  const bare = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(text);
  if (bare) return within(Number(bare[1]), Number(bare[2]));

  return null;
}
