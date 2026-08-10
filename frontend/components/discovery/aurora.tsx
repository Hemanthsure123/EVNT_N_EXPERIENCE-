import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * The drifting colour field behind the showcase.
 *
 * ── WHY THIS AND NOT A VIDEO, A CANVAS OR A SHADER ────────────────────────
 *
 * All three were the obvious alternatives and all three are worse here for the
 * same reason: this sits behind the Largest Contentful Paint element on the
 * front page. A video is a request, a decode and a codec negotiation before it
 * shows anything. A canvas or WebGL layer is a script that must download,
 * parse and run before the first frame — on the slow phone that most needs the
 * page to be fast, and for a decoration.
 *
 * Three blurred divs on CSS keyframes cost one paint and zero requests. They
 * are composited on the GPU, they animate `transform`/`opacity` only, and they
 * are painted the moment the HTML arrives rather than after a bundle does.
 *
 * ── IT IS DECORATION, AND IT IS MARKED AS SUCH ────────────────────────────
 *
 * `aria-hidden` and `-z-10` throughout. Nothing on top of it depends on it for
 * contrast — the cards carry their own surfaces — so a blob passing behind a
 * headline can never make that headline unreadable. That is a structural
 * guarantee rather than a colour choice that happened to work, which matters
 * because the composite position is a function of time and cannot be checked
 * by looking at it once.
 *
 * The animation itself, the cycle lengths and the reduced-motion stop are in
 * `styles/tokens.css` under AURORA — CSS belongs in CSS, and the reasoning for
 * the specific numbers is with them.
 */
export function Aurora({ className }: { className?: string }) {
  return (
    <div className={cn('pointer-events-none absolute inset-0 -z-10 overflow-hidden', className)} aria-hidden>
      <span className="aurora-field aurora-field--one" />
      <span className="aurora-field aurora-field--two" />
      <span className="aurora-field aurora-field--three" />
      {/* The grain the rest of the product already uses. Three heavily blurred
          fields on an 8-bit panel band visibly; a trace of noise is the
          standard fix and it costs nothing extra here. */}
      <div className="hero-noise absolute inset-0" />
    </div>
  );
}
