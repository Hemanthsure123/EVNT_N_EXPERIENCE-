/* eslint-disable local-rules/no-raw-values */
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
        <svg width={140} height={102} viewBox="0 0 44 32" fill="none">
          <defs>
            <linearGradient id="apple-icon-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1B5BFF" />
              <stop offset="100%" stopColor="#9B1BFF" />
            </linearGradient>
          </defs>
          <path
            d="M 14,2 C 6,2 2,8 2,16 C 2,24 6,30 14,30 L 36,30 C 36,28.5 37,27.5 38,27.5 C 39,27.5 40,28.5 40,30 L 42,30 C 42,24 38,21 38,16 C 38,11 42,8 42,2 L 40,2 C 40,3.5 39,4.5 38,4.5 C 37,4.5 36,3.5 36,2 Z"
            fill="url(#apple-icon-grad)"
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
      </div>
    ),
    size,
  );
}
