'use client';

import * as React from 'react';
import { encodeQr, svgExtent, toSvgPath } from '@/lib/booking/qr';
import { cn } from '@/lib/utils/cn';

/**
 * A ticket's QR, drawn from its signed token.
 *
 * ── WHY IT IS ALWAYS DARK-ON-LIGHT, IGNORING THE THEME ────────────────────
 *
 * Every other surface in this product follows the viewer's theme. This one must
 * not. A QR is read by a camera looking for dark modules on a light field; an
 * inverted symbol is decoded by SOME scanners and not others, and the one that
 * matters is whichever device the venue happens to own. `bg-ink-25` /
 * `text-ink-950` are the two token stops that do NOT flip between themes, so
 * the code stays scannable in dark mode without a hard-coded colour anywhere.
 *
 * The quiet zone is part of the symbol, not padding: without four light modules
 * of margin a scanner cannot find the symbol's edge, which is the single most
 * common reason a perfectly-encoded QR fails to read. It is baked into the
 * viewBox by `toSvgPath`, so no layout decision can accidentally crop it.
 *
 * ── ENCODING IS SYNCHRONOUS AND MEMOISED ──────────────────────────────────
 *
 * A version-9 symbol is ~1ms to compute, so there is no loading state and no
 * effect — the code is simply part of the render. Memoised on the token because
 * the confirmation screen polls, and re-encoding an identical token on every
 * poll would be work done to produce the same pixels.
 *
 * `shapeRendering="crispEdges"` matters more than it looks: the default
 * antialiasing softens every module boundary, and a blurred edge is exactly
 * what a camera struggles with at an angle in bad light.
 */
export function TicketQrCode({
  token,
  label,
  className,
}: {
  token: string;
  /** What a screen reader should say. There is nothing readable in the image
   *  itself, so this has to describe the ticket, not the picture. */
  label: string;
  className?: string;
}) {
  const drawing = React.useMemo(() => {
    try {
      const matrix = encodeQr(token);
      return { path: toSvgPath(matrix), extent: svgExtent(matrix) };
    } catch {
      // A token too long for any symbol. Vanishingly unlikely (a ticket token
      // is ~167 bytes against a 2,953-byte ceiling), but drawing nothing beats
      // drawing a truncated code that scans as the wrong ticket.
      return null;
    }
  }, [token]);

  if (!drawing) return null;

  return (
    <svg
      viewBox={`0 0 ${drawing.extent} ${drawing.extent}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={cn('h-auto w-full rounded-lg bg-ink-25 text-ink-950', className)}
    >
      {/* The light field is the element's own background, so the quiet zone
          inside the viewBox is genuinely light rather than transparent over
          whatever card happens to be behind it. */}
      <path d={drawing.path} fill="currentColor" />
    </svg>
  );
}
