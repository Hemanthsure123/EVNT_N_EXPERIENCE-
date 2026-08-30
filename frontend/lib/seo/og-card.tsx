/* eslint-disable local-rules/no-raw-values */
import { OG_TOKENS, rgb, rgba } from './og-tokens';

/**
 * ── ONE SHARE CARD DESIGN, RENDERED BY EVERY ROUTE THAT HAS ONE ───────────
 *
 * Before this, `public/` held a single `favicon.svg` and nothing set an
 * `og:image`. Every share of every URL — a WhatsApp forward of an event, a
 * pasted link in a group, a tweet — rendered as a bare text row or a blank
 * rectangle. On a product whose entire distribution model is somebody sending
 * a friend a link to a gig, that is the most-seen surface in the system and it
 * was empty.
 *
 * The card lives here rather than in each route so the event card and the site
 * card cannot drift into two different brands. Routes pass content; this file
 * owns the design.
 *
 * ── SATORI IS NOT A BROWSER ───────────────────────────────────────────────
 *
 * `next/og` rasterises with Satori, which implements a deliberate subset of
 * CSS. Three constraints shape everything below and each has bitten:
 *
 *  - **Flexbox only.** No grid, no float. Any element with more than one child
 *    needs an explicit `display: 'flex'` or Satori throws rather than guessing.
 *  - **No cascade, no variables.** `var(--primary)` resolves to nothing,
 *    silently. Colours come from `og-tokens.ts`, which is checked against
 *    `styles/tokens.css` by a test for exactly this reason.
 *  - **No `text-overflow: ellipsis` worth relying on.** Long titles are
 *    truncated in JS below, where the behaviour is testable.
 */

const WIDTH = 1200;
const HEIGHT = 630;

export const OG_SIZE = { width: WIDTH, height: HEIGHT };
export const OG_CONTENT_TYPE = 'image/png';

/**
 * ── THE FONT IS BEST-EFFORT, AND THE CARD RENDERS WITHOUT IT ──────────────
 *
 * The product's display face is Space Grotesk, delivered by `next/font/google`
 * — which self-hosts it as **woff2**, a format Satori cannot parse. So the only
 * way to set the card in the brand face is to fetch a TTF at render time.
 *
 * That fetch is wrapped and allowed to fail. A build machine without network
 * access, a Google Fonts hiccup or an air-gapped CI run would otherwise take
 * down every OG route AND the build with it — trading a blank share card for a
 * failed deploy, which is a much worse outcome than a card set in Satori's
 * bundled Noto Sans. The fallback is legible and on-brand-enough; the failure
 * mode is a slightly different typeface, not a missing image.
 *
 * `force-cache` means one fetch per build rather than one per share.
 */
async function loadDisplayFont(): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&display=swap',
      {
        cache: 'force-cache',
        // A desktop UA gets woff2 back; this one gets a plain TTF, which is
        // what Satori can actually read.
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; og-image-renderer)' },
      },
    ).then((r) => (r.ok ? r.text() : ''));

    const url = css.match(/src:\s*url\((https:\/\/[^)]+)\)/)?.[1];
    if (!url) return null;

    const res = await fetch(url, { cache: 'force-cache' });
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/** Satori font descriptors, or an empty list so it falls back to its own face. */
export async function ogFonts() {
  const data = await loadDisplayFont();
  if (!data) return [];
  return [{ name: 'Space Grotesk', data, style: 'normal' as const, weight: 700 as const }];
}

/**
 * Truncate on a WORD boundary, with a real ellipsis.
 *
 * Satori will happily set a 90-character event title at 64px and let it run off
 * the canvas — there is no overflow to hide it. Cutting mid-word ("Sunburn Fes…")
 * reads as a rendering fault rather than as a long name, so this backs up to
 * the last space when there is one close enough to be worth it.
 */
export function truncate(text: string, max: number): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  // Only honour the word boundary if it is not throwing away a third of the
  // budget — otherwise a single very long word would truncate to almost nothing.
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[\s,.;:–—-]+$/, '')}…`;
}

/** The CX monogram, at card scale. Same path data as `components/shell/brand-mark.tsx`. */
function Mark({ size }: { size: number; color?: string }) {
  const height = Math.round(size * (32 / 44));
  return (
    <svg width={size} height={height} viewBox="0 0 44 32" fill="none">
      <defs>
        <linearGradient id="og-mark-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1B5BFF" />
          <stop offset="100%" stopColor="#9B1BFF" />
        </linearGradient>
      </defs>
      <path
        d="M 14,2 C 6,2 2,8 2,16 C 2,24 6,30 14,30 L 36,30 C 36,28.5 37,27.5 38,27.5 C 39,27.5 40,28.5 40,30 L 42,30 C 42,24 38,21 38,16 C 38,11 42,8 42,2 L 40,2 C 40,3.5 39,4.5 38,4.5 C 37,4.5 36,3.5 36,2 Z"
        fill="url(#og-mark-grad)"
      />
      <circle cx="34" cy="8" r="1.1" fill="#FFFFFF" opacity={0.95} />
      <circle cx="34" cy="13.3" r="1.1" fill="#FFFFFF" opacity={0.95} />
      <circle cx="34" cy="18.6" r="1.1" fill="#FFFFFF" opacity={0.95} />
      <circle cx="34" cy="24" r="1.1" fill="#FFFFFF" opacity={0.95} />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M 16,7.5 C 11.3,7.5 7.5,11.3 7.5,16 C 7.5,20.5 11.5,24.5 16,28.5 C 20.5,24.5 24.5,20.5 24.5,16 C 24.5,11.3 20.7,7.5 16,7.5 Z M 16,13.5 A 2.5,2.5 0 1,0 16,18.5 A 2.5,2.5 0 1,0 16,13.5 Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

export type OgCardProps = {
  /** The headline. Truncated here, not by CSS. */
  title: string;
  /** One line under it — a venue and city, or the product's one-liner. */
  subtitle?: string;
  /** Small caps line above the title: a date, a category, a section name. */
  eyebrow?: string;
  /** Bottom-right pill — "From ₹499", "Free entry". Omitted when unknown. */
  badge?: string;
};

/**
 * ── THE CARD ──────────────────────────────────────────────────────────────
 *
 * A dark ink field, because a share card is composited onto surfaces we do not
 * control — WhatsApp's near-white chat, X's dark timeline, an iMessage bubble.
 * A light card disappears into half of them; a dark one holds an edge against
 * all of them, and it matches the app icon.
 *
 * The violet is a soft radial bloom in one corner rather than a block of fill.
 * It is the product's one wayfinding accent (`--primary`), and at this size a
 * flat violet panel would read as a different brand from the near-black chrome
 * everything else uses.
 *
 * No photograph. The obvious upgrade is to composite the event's poster behind
 * the type — but posters are organizer-uploaded, arbitrary aspect ratios, and
 * `events` stores exactly the bytes it is given with no renditions yet
 * (BACKLOG 14 / PENDING_TASKS 2.8). Fetching a 4MB original per share render to
 * downscale it is the wrong shape, and an unpredictable image behind white type
 * is how a card ends up unreadable for one event in ten. Once renditions exist,
 * this is the one place that changes.
 */
export function OgCard({ title, subtitle, eyebrow, badge }: OgCardProps) {
  const field = rgb(OG_TOKENS.ink950);
  const ink = rgb(OG_TOKENS.ink50);
  const muted = rgb(OG_TOKENS.ink400);
  const accent = rgb(OG_TOKENS.violet500);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: field,
        // The bloom. Two stops so it falls off rather than banding.
        backgroundImage: `radial-gradient(circle at 82% 12%, ${rgba(
          OG_TOKENS.violet600,
          0.42,
        )} 0%, ${rgba(OG_TOKENS.violet600, 0)} 46%)`,
        padding: 72,
        fontFamily: 'Space Grotesk, sans-serif',
      }}
    >
      {/* ── Top: the lockup ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Mark size={52} color={ink} />
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <span style={{ color: ink, fontSize: 38, fontWeight: 700, letterSpacing: '-0.02em' }}>
            Curatix
          </span>
          {/* The full stop is the one surviving brand colour in the wordmark —
              same decision `BrandLockup` makes in the header. */}
          <span style={{ color: accent, fontSize: 38, fontWeight: 700 }}>.</span>
        </div>
      </div>

      {/* ── Middle: the message ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 940 }}>
        {eyebrow ? (
          <span
            style={{
              color: accent,
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {truncate(eyebrow, 48)}
          </span>
        ) : null}

        <span
          style={{
            color: ink,
            // 68px holds two lines of a long title inside the canvas. The
            // tight tracking is the type scale's rule for display sizes: a
            // geometric sans at this size reads loose at default tracking.
            fontSize: 68,
            fontWeight: 700,
            lineHeight: 1.08,
            letterSpacing: '-0.03em',
          }}
        >
          {truncate(title, 84)}
        </span>

        {subtitle ? (
          <span style={{ color: muted, fontSize: 30, lineHeight: 1.35 }}>
            {truncate(subtitle, 96)}
          </span>
        ) : null}
      </div>

      {/* ── Bottom: the rule, the domain, the price ─────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: `1px solid ${rgba(OG_TOKENS.ink50, 0.16)}`,
          paddingTop: 28,
        }}
      >
        <span style={{ color: muted, fontSize: 24 }}>Book tickets · get in with a single scan</span>
        {badge ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: rgba(OG_TOKENS.ink50, 0.1),
              border: `1px solid ${rgba(OG_TOKENS.ink50, 0.2)}`,
              borderRadius: 999,
              padding: '12px 26px',
            }}
          >
            <span style={{ color: ink, fontSize: 26, fontWeight: 700 }}>{truncate(badge, 24)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
