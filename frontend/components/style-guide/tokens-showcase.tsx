import * as React from 'react';
import { Section, Subsection, Swatch } from './section';

const SEMANTIC: { token: string; name: string }[] = [
  { token: 'background', name: 'Background' },
  { token: 'foreground', name: 'Foreground' },
  { token: 'surface', name: 'Surface' },
  { token: 'elevated', name: 'Elevated' },
  { token: 'muted', name: 'Muted' },
  { token: 'border', name: 'Border' },
  { token: 'primary', name: 'Primary' },
  { token: 'primary-hover', name: 'Primary hover' },
  { token: 'secondary', name: 'Secondary' },
  { token: 'accent', name: 'Accent' },
  { token: 'ring', name: 'Ring' },
  { token: 'success', name: 'Success' },
  { token: 'warning', name: 'Warning' },
  { token: 'destructive', name: 'Destructive' },
  { token: 'info', name: 'Info' },
];

const VIOLET = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
const SLATE = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
const PINK = [50, 300, 500, 600];

const TYPE_SCALE: { cls: string; name: string; sample: string }[] = [
  { cls: 'text-display font-display', name: 'Display · 48/56', sample: 'Discover live events' },
  { cls: 'text-h1 font-display', name: 'H1 · 36/44', sample: 'Discover live events' },
  { cls: 'text-h2 font-display', name: 'H2 · 30/38', sample: 'Discover live events' },
  { cls: 'text-h3 font-display', name: 'H3 · 24/32', sample: 'Discover live events' },
  { cls: 'text-h4 font-display', name: 'H4 · 20/28', sample: 'Discover live events' },
  { cls: 'text-body-lg', name: 'Body large · 18/28', sample: 'Book tickets in seconds.' },
  { cls: 'text-body', name: 'Body · 16/24', sample: 'Book tickets in seconds.' },
  { cls: 'text-body-sm', name: 'Body small · 14/20', sample: 'Book tickets in seconds.' },
  { cls: 'text-label', name: 'Label · 13/16', sample: 'BOOK TICKETS' },
  { cls: 'text-caption', name: 'Caption · 12/16', sample: 'Updated just now' },
];

const SPACING: { name: string; cls: string }[] = [
  { name: '1 · 4px', cls: 'w-1' },
  { name: '2 · 8px', cls: 'w-2' },
  { name: '3 · 12px', cls: 'w-3' },
  { name: '4 · 16px', cls: 'w-4' },
  { name: '6 · 24px', cls: 'w-6' },
  { name: '8 · 32px', cls: 'w-8' },
  { name: '12 · 48px', cls: 'w-12' },
  { name: '16 · 64px', cls: 'w-16' },
];

export function TokensShowcase() {
  return (
    <div className="flex flex-col gap-16">
      <Section
        id="colours"
        title="Colour"
        description="Semantic role tokens (used by every component) plus the raw brand ramp. Each swatch reads its value straight from a CSS variable — toggle the theme to watch them flip."
      >
        <Subsection title="Semantic roles">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {SEMANTIC.map((s) => (
              <Swatch key={s.token} token={s.token} name={s.name} />
            ))}
          </div>
        </Subsection>
        <Subsection title="Violet (brand · 600 primary)">
          <div className="grid grid-cols-5 gap-3 sm:grid-cols-10">
            {VIOLET.map((s) => (
              <Swatch key={s} token={`violet-${s}`} name={`${s}`} />
            ))}
          </div>
        </Subsection>
        <Subsection title="Pink (accent · 500) & Slate (neutrals)">
          <div className="grid grid-cols-4 gap-3">
            {PINK.map((s) => (
              <Swatch key={s} token={`pink-${s}`} name={`Pink ${s}`} />
            ))}
          </div>
          <div className="mt-3 grid grid-cols-5 gap-3 sm:grid-cols-10">
            {SLATE.map((s) => (
              <Swatch key={s} token={`slate-${s}`} name={`${s}`} />
            ))}
          </div>
        </Subsection>
        <Subsection title="Gradients">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex h-24 items-end rounded-xl bg-gradient-brand p-4 text-caption font-medium text-white">
              Brand / Hero
            </div>
            <div className="flex h-24 items-end rounded-xl bg-gradient-royal p-4 text-caption font-medium text-white">
              Royal
            </div>
            <div className="flex h-24 items-end rounded-xl bg-gradient-sunset p-4 text-caption font-medium text-white">
              Sunset
            </div>
          </div>
        </Subsection>
      </Section>

      <Section
        id="type"
        title="Typography"
        description="Space Grotesk for display, Inter for body/UI, JetBrains Mono for figures — self-hosted via next/font with display:swap."
      >
        <div className="flex flex-col divide-y divide-border">
          {TYPE_SCALE.map((t) => (
            <div
              key={t.name}
              className="flex flex-col gap-1 py-4 md:flex-row md:items-baseline md:gap-8"
            >
              <span className="w-40 shrink-0 font-mono text-caption text-muted-foreground">
                {t.name}
              </span>
              <span className={t.cls}>{t.sample}</span>
            </div>
          ))}
          <div className="flex items-baseline gap-8 py-4">
            <span className="w-40 shrink-0 font-mono text-caption text-muted-foreground">
              Mono · tabular
            </span>
            <span className="font-mono text-body tabular-nums">₹1,299.00 · #A1B2C3 · 482913</span>
          </div>
        </div>
      </Section>

      <Section
        id="spacing"
        title="Spacing, radius & elevation"
        description="A 4px base / 8px rhythm (Tailwind's default scale), one canonical 20px card radius, and soft cool-tinted shadows."
      >
        <Subsection title="Spacing scale">
          <div className="flex flex-col gap-2">
            {SPACING.map((s) => (
              <div key={s.name} className="flex items-center gap-4">
                <span className="w-20 font-mono text-caption text-muted-foreground">{s.name}</span>
                <span className={`${s.cls} h-4 rounded-sm bg-primary`} />
              </div>
            ))}
          </div>
        </Subsection>
        <Subsection title="Radius">
          <div className="flex flex-wrap gap-4">
            {[
              { cls: 'rounded-sm', name: 'sm · 8' },
              { cls: 'rounded-md', name: 'md · 12' },
              { cls: 'rounded-lg', name: 'lg · 16' },
              { cls: 'rounded-xl', name: 'xl · 20' },
              { cls: 'rounded-2xl', name: '2xl · 24' },
            ].map((r) => (
              <div key={r.name} className="flex flex-col items-center gap-2">
                <div className={`size-16 border border-border bg-surface shadow-md ${r.cls}`} />
                <span className="font-mono text-caption text-muted-foreground">{r.name}</span>
              </div>
            ))}
          </div>
        </Subsection>
        <Subsection title="Elevation">
          <div className="flex flex-wrap gap-6">
            {[
              { cls: 'shadow-sm', name: 'sm' },
              { cls: 'shadow-md', name: 'md' },
              { cls: 'shadow-lg', name: 'lg' },
              { cls: 'shadow-xl', name: 'xl' },
              { cls: 'shadow-glow', name: 'glow' },
            ].map((sh) => (
              <div key={sh.name} className="flex flex-col items-center gap-2">
                <div className={`size-20 rounded-xl bg-surface ${sh.cls}`} />
                <span className="font-mono text-caption text-muted-foreground">{sh.name}</span>
              </div>
            ))}
          </div>
        </Subsection>
        <Subsection title="Motion (hover the cards — CSS transitions honour reduced-motion)">
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { name: 'fast · 120ms', cls: 'duration-fast' },
              { name: 'base · 200ms', cls: 'duration-base' },
              { name: 'slow · 320ms', cls: 'duration-slow' },
            ].map((m) => (
              <div
                key={m.name}
                className={`flex h-24 cursor-pointer items-center justify-center rounded-xl border border-border bg-surface text-body-sm shadow-md transition ease-out hover:-translate-y-1 hover:shadow-lg ${m.cls}`}
              >
                {m.name}
              </div>
            ))}
          </div>
        </Subsection>
      </Section>
    </div>
  );
}
