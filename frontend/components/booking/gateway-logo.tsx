import * as React from 'react';
import type { PaymentProvider } from '@/lib/booking/payment-provider';
import { cn } from '@/lib/utils/cn';

/**
 * The gateway marks used in the payment selector.
 *
 * ── THESE ARE BRAND-COLOURED GLYPHS, NOT THE OFFICIAL LOGOTYPES ───────────
 *
 * Both marks are trademarks, and their real artwork is distributed through
 * each provider's brand kit under terms about spacing, minimum size and
 * recolouring. Inlining a traced approximation and calling it the official
 * logo would be a claim this file cannot back — the same rule that keeps
 * invented ratings and fabricated "verified" badges off every other surface in
 * this product, applied to somebody else's mark instead of our own data.
 *
 * So each is a geometric glyph in the provider's own primary colour: instantly
 * distinguishable side by side, correct at 20px, and legible in both themes.
 *
 * ── THE COLOURS ARE TOKENS, AND THEY DO NOT FLIP WITH THE THEME ───────────
 *
 * `--brand-cashfree` / `--brand-razorpay` live in `styles/tokens.css` beside
 * the `ink` ramp, and for the same reason it is theme-INDEPENDENT: these
 * identify somebody else's brand, and a mark that changed colour when the
 * reader flipped a theme toggle would stop doing that job. Hard-coding the hex
 * here would trip `local-rules/no-raw-values`, and the rule is right — a
 * colour nobody can find from the tokens file is a colour nobody can update.
 *
 * `provider-marks.tsx` solved the same problem the other way, drawing Google
 * in `currentColor`, because Google's guidelines explicitly permit a
 * monochrome mark. Two gateways sitting in one menu is the case where colour
 * is doing real work: it is what makes the rows tellable apart at a glance,
 * which is the whole job of a logo in a picker.
 *
 * ── DROPPING IN THE REAL ARTWORK ──────────────────────────────────────────
 *
 * Put the official SVG at `public/brand/cashfree.svg` / `public/brand/
 * razorpay.svg` and replace the matching `case` below with an `<img>` (or
 * `next/image`) pointing at it. One line each, nothing else in the checkout
 * changes, and the sizing contract (`size` -> a square box) is already here.
 * Until that happens these render and are honest about what they are.
 */

export function GatewayLogo({
  provider,
  size = 24,
  className,
}: {
  provider: PaymentProvider;
  size?: number;
  className?: string;
}) {
  // `aria-hidden` on every mark: the provider's NAME is always rendered beside
  // it, so announcing the glyph too would read the same word twice. The icon
  // is decoration for a label that is already there.
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    'aria-hidden': true as const,
    className: cn('shrink-0', className),
  };

  if (provider === 'cashfree') {
    return (
      <svg {...common} fill="none">
        <rect width="24" height="24" rx="6" className="fill-brand-cashfree" />
        {/* A forward chevron pair — Cashfree's mark reads as motion. */}
        <path
          d="M7 7.5 11.5 12 7 16.5"
          className="stroke-brand-on-brand"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M13 7.5 17.5 12 13 16.5"
          className="stroke-brand-on-brand/60"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (provider === 'razorpay') {
    return (
      <svg {...common} fill="none">
        <rect width="24" height="24" rx="6" className="fill-brand-razorpay" />
        {/* Razorpay's mark is an angular ascending stroke over a stem. */}
        <path d="M15.8 5.5 12.4 18.5H9.7l1.5-5.7 4.6-7.3Z" className="fill-brand-on-brand" />
        <path d="M8.6 9.4h5.1l-1 3.3-3.4 5.8H6.6l2-9.1Z" className="fill-brand-on-brand/65" />
      </svg>
    );
  }

  // Demo mode. Deliberately NOT a brand mark of any kind — a familiar logo
  // beside a simulated payment is the one place a logo would actively mislead.
  return (
    <svg {...common} fill="none">
      <rect
        width="23"
        height="23"
        x="0.5"
        y="0.5"
        rx="5.5"
        className="fill-muted stroke-border-strong"
        strokeDasharray="3 2.5"
      />
      <path
        d="M9.5 6.5v4.2L6.8 16a1.6 1.6 0 0 0 1.4 2.4h7.6a1.6 1.6 0 0 0 1.4-2.4l-2.7-5.3V6.5"
        className="stroke-muted-foreground"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.8 6.5h6.4"
        className="stroke-muted-foreground"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
