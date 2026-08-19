import { JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';

/**
 * Self-hosted fonts via next/font (subset + `display: swap`, so no layout shift
 * and no render-blocking network). Each exposes a CSS variable that the
 * Tailwind `fontFamily` tokens consume — nothing in the app names a font
 * directly.
 *
 * ── ONE FAMILY, TWO ROLES ─────────────────────────────────────────────────
 *
 * This shipped as Space Grotesk for headings over Inter for body: two families
 * whose skeletons disagree, which is why the old headings read as a different
 * product from the paragraphs under them.
 *
 * **Plus Jakarta Sans** now does both jobs. It is a geometric grotesque with
 * near-circular bowls, a tall x-height and a genuinely wide weight axis
 * (200–800), so the SAME family covers a 40px extrabold display line and a
 * 13px medium chip label without either looking borrowed. That is what the
 * reference design does — a single face, separated by weight and tracking
 * rather than by family — and it is also cheaper: one font to download instead
 * of two, on the page that decides whether somebody stays.
 *
 * `--font-display` and `--font-sans` therefore resolve to the same face. They
 * stay as SEPARATE variables on purpose: every heading in the app already says
 * `font-display`, so putting a real display face back later is a change to
 * this file and nothing else.
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  // The full range the type scale actually uses: 500 for chips and labels,
  // 800 for the hero. Listing only what is used keeps the payload honest.
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
});

const jakartaDisplay = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  weight: ['600', '700', '800'],
  variable: '--font-display',
});

export const fontSans = jakarta;
export const fontDisplay = jakartaDisplay;

export const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
});

/** All font CSS-variable classes, applied once at the app/root (or Storybook). */
export const fontClassNames = `${fontSans.variable} ${fontDisplay.variable} ${fontMono.variable}`;
