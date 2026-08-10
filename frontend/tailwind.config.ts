import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Tailwind theme = a thin projection of the design tokens (styles/tokens.css).
 * Every value here resolves to a CSS variable, so the tokens file stays the one
 * source of truth and the whole app reskins by swapping variables. Colours use
 * `rgb(var(--x) / <alpha-value>)` so opacity utilities (bg-primary/10) work.
 *
 * NOTHING in this file is a raw value except the type scale, the breakpoints and
 * two container widths — everything with a colour, a radius, a shadow or a
 * rhythm rung points at a token.
 */

/** Build a Tailwind colour that supports the `/opacity` modifier from a token. */
const rgb = (token: string) => `rgb(var(--${token}) / <alpha-value>)`;

/** A ramp projected from `--<name>-<stop>` tokens. */
const ramp = (name: string, stops: (number | string)[]) =>
  Object.fromEntries(stops.map((s) => [s, rgb(`${name}-${s}`)]));

/**
 * The event category slugs, mirroring `CategorySlug` in lib/discovery/categories.ts.
 * Each one has a soft pastel tint + a deep ink partner in tokens.css, so a
 * category tile is `bg-tint-<slug>` with `text-tint-<slug>-ink` on it and no
 * component ever has to map a slug to a colour by hand.
 */
const CATEGORY_SLUGS = [
  'concerts',
  'comedy',
  'workshops',
  'sports',
  'festivals',
  'nightlife',
  'food-drink',
  'tech',
] as const;

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx,mdx}',
    './components/**/*.{ts,tsx,mdx}',
    './lib/**/*.{ts,tsx}',
    './.storybook/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: '1rem', lg: '1.5rem' },
      screens: { '2xl': '1280px' },
    },
    // Breakpoints (§6.2, mobile-first).
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
    extend: {
      colors: {
        // ── Surfaces ───────────────────────────────────────────────────────
        // In LIGHT, background === surface === elevated (all pure white) and a
        // card separates with `border-border` + `shadow-sm/md`, not by value.
        // `bg-surface` on its own is invisible there — always pair it.
        // `bg-sunken` is the one step DOWN: section bands and recessed wells.
        // In DARK all four are distinct values (see the ladder in tokens.css).
        background: rgb('background'),
        surface: { DEFAULT: rgb('surface'), foreground: rgb('surface-foreground') },
        elevated: rgb('elevated'),
        sunken: rgb('sunken'),

        // ── Ink ────────────────────────────────────────────────────────────
        // `text-foreground` headings/body, `text-muted-foreground` secondary,
        // `text-foreground-subtle` tertiary. The third rung exists so meta text
        // stops being written as `text-muted-foreground/70`, which produces an
        // unverifiable contrast ratio that changes with whatever is behind it.
        foreground: { DEFAULT: rgb('foreground'), subtle: rgb('foreground-subtle') },
        muted: { DEFAULT: rgb('muted'), foreground: rgb('muted-foreground') },

        // ── Lines ──────────────────────────────────────────────────────────
        // `border` is a hairline (1.27:1 on white) — it delineates, it does not
        // divide. `border-strong` is for a rule that has to actually separate.
        // `input` clears 3:1 in both themes because a field's edge is its only
        // affordance.
        border: { DEFAULT: rgb('border'), strong: rgb('border-strong') },
        input: rgb('input'),
        ring: rgb('ring'),
        overlay: rgb('overlay'),
        'on-gradient': rgb('on-gradient'),

        // ── THE PRIMARY ACTION ─────────────────────────────────────────────
        // Near-black pill in light, near-white pill in dark. This is what
        // Button's `primary` variant fills with — NOT `primary`.
        cta: {
          DEFAULT: rgb('cta'),
          foreground: rgb('cta-foreground'),
          hover: rgb('cta-hover'),
          active: rgb('cta-active'),
        },

        // ── The brand / wayfinding accent ──────────────────────────────────
        // Violet. The search icon, a date, a selected hairline, the focus ring.
        // Used sparingly; never a full-width CTA fill any more.
        primary: {
          DEFAULT: rgb('primary'),
          foreground: rgb('primary-foreground'),
          hover: rgb('primary-hover'),
          active: rgb('primary-active'),
        },
        // Quiet neutral tint (secondary buttons, info pills). No longer violet.
        secondary: { DEFAULT: rgb('secondary'), foreground: rgb('secondary-foreground') },
        // The deeper step of the wayfinding violet. No longer pink.
        accent: {
          DEFAULT: rgb('accent'),
          foreground: rgb('accent-foreground'),
          hover: rgb('accent-hover'),
        },
        // The active navigation pill: warm butter/cream with dark ink. Its own
        // token rather than a re-tint of `secondary`, which 82 call sites use
        // for something else entirely.
        'nav-active': {
          DEFAULT: rgb('nav-active'),
          foreground: rgb('nav-active-foreground'),
          hover: rgb('nav-active-hover'),
        },

        success: {
          DEFAULT: rgb('success'),
          foreground: rgb('success-foreground'),
          subtle: rgb('success-subtle'),
          'subtle-foreground': rgb('success-subtle-foreground'),
        },
        warning: {
          DEFAULT: rgb('warning'),
          foreground: rgb('warning-foreground'),
          subtle: rgb('warning-subtle'),
          'subtle-foreground': rgb('warning-subtle-foreground'),
        },
        destructive: {
          DEFAULT: rgb('destructive'),
          foreground: rgb('destructive-foreground'),
          subtle: rgb('destructive-subtle'),
          'subtle-foreground': rgb('destructive-subtle-foreground'),
        },
        info: {
          DEFAULT: rgb('info'),
          foreground: rgb('info-foreground'),
          subtle: rgb('info-subtle'),
          'subtle-foreground': rgb('info-subtle-foreground'),
        },

        // ── Category pastels ───────────────────────────────────────────────
        // `bg-tint-comedy` + `text-tint-comedy-ink`. Both flip with the theme
        // and both were contrast-checked against each other AND against the
        // canvas, so a tile is legible whichever way it is composed.
        tint: Object.fromEntries(
          CATEGORY_SLUGS.map((slug) => [
            slug,
            { DEFAULT: rgb(`tint-${slug}`), ink: rgb(`tint-${slug}-ink`) },
          ]),
        ),

        // ── Primitive ramps — for the rare case a specific shade is needed ──
        // `ink` is the warm neutral the light-first product is built on; it
        // replaces the old violet-tinted `canvas` ramp.
        ink: ramp('ink', [25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        butter: ramp('butter', [50, 100, 200, 300, 800, 900, 950]),
        violet: ramp('violet', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        pink: ramp('pink', [50, 300, 500, 600]),
        slate: ramp('slate', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
      },
      backgroundImage: {
        'gradient-brand': 'var(--gradient-brand)',
        'gradient-royal': 'var(--gradient-royal)',
        'gradient-sunset': 'var(--gradient-sunset)',
      },
      // Retuned down one rung — see the radius note in tokens.css. Cards
      // (`rounded-xl`) are now 16px and panels/modals (`rounded-2xl`) 20px,
      // which lands every existing call site inside the target range without
      // editing one of them. Buttons, inputs and search are `rounded-full`.
      minHeight: {
        'ticket-scroll': 'var(--ticket-scroll-min)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
        full: 'var(--radius-full)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        // No longer a violet halo — the neutral hover lift. See tokens.css.
        glow: 'var(--shadow-glow)',
        none: 'none',
      },
      // Named so a sticky bar can use the system's blur instead of guessing at
      // `backdrop-blur-md`, and so retuning `--blur-glass` moves all of them.
      backdropBlur: {
        glass: 'var(--blur-glass)',
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      /**
       * Type scale. Headings got LARGER and HEAVIER, and the tracking tightens
       * as the size grows — a geometric sans set at 56px with default tracking
       * reads loose and web-defaulty, which is the single most common way a
       * type scale gives away that nobody chose it.
       *
       * The step between rungs matters more than any individual size: 56 / 40 /
       * 32 / 24 / 20 against a 16px body is a clear ladder, where the old
       * 48 / 36 / 30 / 24 / 20 had h2 and h3 only 6px apart and h1 and display
       * doing nearly the same job.
       *
       * `label` went 500 → 600 because it is the button label, and a near-black
       * pill wants a label with enough weight to hold the fill.
       *
       * Only `not-found.tsx` uses `text-display` unguarded by a breakpoint (on
       * the string "404"); every other call site is `text-h1 md:text-display`,
       * so the bump costs nothing on a narrow viewport.
       */
      fontSize: {
        display: ['56px', { lineHeight: '60px', letterSpacing: '-0.03em', fontWeight: '800' }],
        h1: ['40px', { lineHeight: '48px', letterSpacing: '-0.025em', fontWeight: '800' }],
        h2: ['32px', { lineHeight: '40px', letterSpacing: '-0.02em', fontWeight: '700' }],
        h3: ['24px', { lineHeight: '32px', letterSpacing: '-0.01em', fontWeight: '700' }],
        h4: ['20px', { lineHeight: '28px', letterSpacing: '-0.005em', fontWeight: '600' }],
        'body-lg': ['18px', { lineHeight: '28px' }],
        body: ['16px', { lineHeight: '24px' }],
        'body-sm': ['14px', { lineHeight: '20px' }],
        label: ['13px', { lineHeight: '16px', letterSpacing: '0.01em', fontWeight: '600' }],
        caption: ['12px', { lineHeight: '16px', fontWeight: '500' }],
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        base: 'var(--duration-base)',
        slow: 'var(--duration-slow)',
        page: 'var(--duration-page)',
        reveal: 'var(--duration-reveal)',
        carousel: 'var(--duration-carousel)',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        'in-out': 'var(--ease-in-out)',
        spring: 'var(--ease-spring)',
      },
      // Transient overlays outrank page chrome. `sticky` used to sit ABOVE
      // `dropdown`, which meant a Select opened from the sticky filter bar
      // rendered UNDERNEATH it — the options were there, just unclickable.
      // A sticky header is furniture; a dropdown is a conversation, and a
      // conversation always wins.
      zIndex: {
        sticky: '1000',
        dropdown: '1100',
        drawer: '1200',
        modal: '1300',
        popover: '1400',
        toast: '1500',
        tooltip: '1600',
      },
      maxWidth: {
        container: '1280px',
        // The organizer dashboard's content cap. Wider than the marketing
        // container because a nine-column table needs the room, but still
        // capped — a table stretched across an ultrawide is unreadable.
        dashboard: '1600px',
      },
      // The canonical page rhythm, so no section invents its own vertical
      // padding (see the 8pt-grid note in styles/tokens.css).
      spacing: {
        section: 'var(--space-section)',
        'section-lg': 'var(--space-section-lg)',
        // The other three rungs of the rhythm. Exposed as utilities so a
        // component reaches for `gap-block` / `mb-stack` / `p-card` instead of
        // picking a number, which is how the scale drifted in the first place.
        block: 'var(--space-block)',
        'block-lg': 'var(--space-block-lg)',
        stack: 'var(--space-stack)',
        'stack-lg': 'var(--space-stack-lg)',
        card: 'var(--space-card)',
        'card-lg': 'var(--space-card-lg)',
        // Horizontal padding for a fully-rounded button. `px-pill` / `px-pill-lg`
        // — the corners of a pill eat the ends of its label, so it needs more
        // room than a rectangle at the same optical weight.
        pill: 'var(--space-pill)',
        'pill-lg': 'var(--space-pill-lg)',
        // Control heights, named so 44px (the touch-target floor) cannot drift.
        'control-sm': 'var(--control-height-sm)',
        control: 'var(--control-height)',
        'control-lg': 'var(--control-height-lg)',
        header: 'var(--header-height)',
        'header-lg': 'var(--header-height-lg)',
        // Chrome offsets, so a sticky rail is `lg:top-sticky-top-lg` and a
        // mobile action bar is `bottom-bottom-nav`, instead of each one
        // hard-coding a number that silently desynchronises when the chrome
        // changes height.
        'bottom-nav': 'var(--bottom-nav-height)',
        'sticky-top': 'var(--sticky-top)',
        'sticky-top-lg': 'var(--sticky-top-lg)',
        // How tall the event poster is allowed to get. Named because the
        // number is a JUDGEMENT — enough of the viewport that the artwork
        // reads, little enough that the title and the ticket panel stay above
        // the fold — and a judgement belongs in one place, not inline on one
        // component as an arbitrary value.
        'hero-media': 'var(--hero-media-height)',
        // The organizer sidebar's two widths, named so neither is an
        // arbitrary value and both can be retuned in one place. 280 / 80px on
        // the 8pt grid.
        sidebar: '17.5rem',
        'sidebar-collapsed': '5rem',
      },
      // Named ratios keep reserved media boxes out of arbitrary values, so the
      // no-raw-values rule stays the only way to size anything.
      aspectRatio: {
        // THE event poster card. Portrait, full-bleed image, text BELOW it —
        // this is the shape the discovery language is built on now. `card`
        // (3:2) stays for row thumbnails and anything genuinely landscape.
        portrait: '3 / 4',
        card: '3 / 2', // landscape thumbnail / row media
        feature: '4 / 3', // hero featured slide
        poster: '4 / 5', // the taller portrait frame (mobile carousel)
        hero: '21 / 8', // full-bleed banner
      },
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'fade-rise': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.97)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        // Autoplay progress: one run per slide interval.
        progress: {
          '0%': { width: '0%' },
          '100%': { width: '100%' },
        },
        // Saving something: ONE beat, on the icon only. The full
        // fly-into-the-header flourish was not built — when signed out there
        // is no Saved link in the header to fly to, so it would animate
        // towards nothing.
        'heart-pop': {
          '0%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(1.28)' },
          '70%': { transform: 'scale(0.94)' },
          '100%': { transform: 'scale(1)' },
        },
        // The ring the beat leaves behind — expands once and fades out.
        'ring-out': {
          '0%': { transform: 'scale(0.7)', opacity: '0.55' },
          '100%': { transform: 'scale(1.75)', opacity: '0' },
        },
        // Ambient hero particles — transform only, so it stays off the main thread.
        drift: {
          '0%': { transform: 'translate3d(0, 0, 0)' },
          '100%': { transform: 'translate3d(-130px, -65px, 0)' },
        },
        // The header's route-pending bar. It decelerates and stops short of
        // the end on purpose — the remaining time is genuinely unknown, and a
        // bar that reaches 100% and then waits is a lie about progress.
        // `scaleX` off a left origin, so it never touches layout.
        'route-progress': {
          '0%': { transform: 'scaleX(0)' },
          '25%': { transform: 'scaleX(0.4)' },
          '60%': { transform: 'scaleX(0.72)' },
          '100%': { transform: 'scaleX(0.9)' },
        },
      },
      animation: {
        'fade-rise': 'fade-rise var(--duration-slow) var(--ease-out)',
        'fade-in': 'fade-in var(--duration-base) var(--ease-out)',
        'scale-in': 'scale-in var(--duration-base) var(--ease-out)',
        progress: 'progress 5000ms linear forwards',
        'heart-pop': 'heart-pop 420ms var(--ease-out)',
        'ring-out': 'ring-out 520ms var(--ease-out) forwards',
      },
    },
  },
  plugins: [animate],
};

export default config;
