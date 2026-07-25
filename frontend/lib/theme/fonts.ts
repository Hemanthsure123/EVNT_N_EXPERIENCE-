import { Inter, JetBrains_Mono, Space_Grotesk } from 'next/font/google';

/**
 * Self-hosted fonts via next/font (subset + display:swap for zero layout shift
 * and no render-blocking network). Each exposes a CSS variable consumed by the
 * Tailwind fontFamily tokens.
 *
 * Display face: the Design System specifies "Satoshi (or Sora / Space Grotesk)".
 * Satoshi isn't on Google Fonts, so we ship the sanctioned alternative
 * **Space Grotesk** now; swapping to real Satoshi later is a one-line change to
 * next/font/local here — nothing else in the app moves.
 */
export const fontSans = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const fontDisplay = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  weight: ['500', '600', '700'],
  variable: '--font-display',
});

export const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
});

/** All font CSS-variable classes, applied once at the app/root (or Storybook). */
export const fontClassNames = `${fontSans.variable} ${fontDisplay.variable} ${fontMono.variable}`;
