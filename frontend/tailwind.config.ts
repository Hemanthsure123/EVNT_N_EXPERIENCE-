import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Tailwind theme = a thin projection of the design tokens (styles/tokens.css).
 * Every value here resolves to a CSS variable, so the tokens file stays the one
 * source of truth and the whole app reskins by swapping variables. Colours use
 * `rgb(var(--x) / <alpha-value>)` so opacity utilities (bg-primary/10) work.
 */

/** Build a Tailwind colour that supports the `/opacity` modifier from a token. */
const rgb = (token: string) => `rgb(var(--${token}) / <alpha-value>)`;

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
        // Semantic role tokens — components use these.
        background: rgb('background'),
        foreground: rgb('foreground'),
        surface: { DEFAULT: rgb('surface'), foreground: rgb('surface-foreground') },
        elevated: rgb('elevated'),
        muted: { DEFAULT: rgb('muted'), foreground: rgb('muted-foreground') },
        border: rgb('border'),
        input: rgb('input'),
        ring: rgb('ring'),
        overlay: rgb('overlay'),
        primary: {
          DEFAULT: rgb('primary'),
          foreground: rgb('primary-foreground'),
          hover: rgb('primary-hover'),
          active: rgb('primary-active'),
        },
        secondary: { DEFAULT: rgb('secondary'), foreground: rgb('secondary-foreground') },
        accent: {
          DEFAULT: rgb('accent'),
          foreground: rgb('accent-foreground'),
          hover: rgb('accent-hover'),
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
        // Primitive ramp — for the rare case a specific shade is needed.
        violet: Object.fromEntries(
          [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((s) => [s, rgb(`violet-${s}`)]),
        ),
        pink: Object.fromEntries([50, 300, 500, 600].map((s) => [s, rgb(`pink-${s}`)])),
        slate: Object.fromEntries(
          [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((s) => [s, rgb(`slate-${s}`)]),
        ),
      },
      backgroundImage: {
        'gradient-brand': 'var(--gradient-brand)',
        'gradient-royal': 'var(--gradient-royal)',
        'gradient-sunset': 'var(--gradient-sunset)',
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
        glow: 'var(--shadow-glow)',
        none: 'none',
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      // Type scale (§5.2).
      fontSize: {
        display: ['48px', { lineHeight: '56px', letterSpacing: '-0.02em', fontWeight: '700' }],
        h1: ['36px', { lineHeight: '44px', letterSpacing: '-0.02em', fontWeight: '700' }],
        h2: ['30px', { lineHeight: '38px', letterSpacing: '-0.01em', fontWeight: '600' }],
        h3: ['24px', { lineHeight: '32px', fontWeight: '600' }],
        h4: ['20px', { lineHeight: '28px', fontWeight: '600' }],
        'body-lg': ['18px', { lineHeight: '28px' }],
        body: ['16px', { lineHeight: '24px' }],
        'body-sm': ['14px', { lineHeight: '20px' }],
        label: ['13px', { lineHeight: '16px', fontWeight: '500' }],
        caption: ['12px', { lineHeight: '16px', fontWeight: '500' }],
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        base: 'var(--duration-base)',
        slow: 'var(--duration-slow)',
        page: 'var(--duration-page)',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        'in-out': 'var(--ease-in-out)',
      },
      zIndex: {
        dropdown: '1000',
        sticky: '1100',
        drawer: '1200',
        modal: '1300',
        popover: '1400',
        toast: '1500',
        tooltip: '1600',
      },
      maxWidth: { container: '1280px' },
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
      },
      animation: {
        'fade-rise': 'fade-rise var(--duration-slow) var(--ease-out)',
        'fade-in': 'fade-in var(--duration-base) var(--ease-out)',
        'scale-in': 'scale-in var(--duration-base) var(--ease-out)',
      },
    },
  },
  plugins: [animate],
};

export default config;
