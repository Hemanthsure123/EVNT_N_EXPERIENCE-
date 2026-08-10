import { ImageResponse } from 'next/og';
import { OG_TOKENS, rgb } from '@/lib/seo/og-tokens';

/**
 * The iOS home-screen icon.
 *
 * A separate route from `app/icon.tsx` for one reason that is specific to iOS:
 * **Safari applies its own rounded-rectangle mask and does not honour
 * `purpose: 'maskable'`**, so the Android safe-area inset that `icon.tsx`
 * carries is wasted padding here — an iOS icon that reserves 19% on every side
 * reads as a small mark floating in a large tile next to every other app.
 *
 * The corner radius is also Apple's to apply, not ours: drawing our own rounded
 * corners produces a dark halo where our radius and the system's disagree,
 * which is the single most common way a home-screen icon looks unfinished. So
 * this is a full-bleed square with a larger glyph, and iOS rounds it.
 *
 * 180×180 is the size iOS actually requests for `apple-touch-icon` on modern
 * devices; it downsamples cleanly for the older 152/167 slots.
 */

/** Edge, for the reason documented at length in `app/icon.tsx`. */
export const runtime = 'edge';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  const field = rgb(OG_TOKENS.ink950);
  const glyph = rgb(OG_TOKENS.ink50);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: field,
        }}
      >
        {/* 132/180 = 73% — larger than the Android tile because iOS masks
            rather than crops, so there is no safe circle to stay inside. */}
        <svg width={132} height={132} viewBox="0 0 48 48" fill="none">
          <path
            d="M30 12.5a14 14 0 1 0 0 23"
            stroke={glyph}
            strokeWidth={4.5}
            strokeLinecap="round"
          />
          <path
            d="M27 15.5 42 32.5M42 15.5 27 32.5"
            stroke={glyph}
            strokeWidth={4.5}
            strokeLinecap="round"
          />
        </svg>
      </div>
    ),
    size,
  );
}
