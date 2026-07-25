# Frontend — Event & Experience Platform

The Next.js frontend. This slice is the **foundation only**: the design system
as the single source of truth, the performance baseline, the typed data layer,
and the core reusable component library + app shell. Feature screens come later.

## Stack

Next.js 14 (App Router, RSC) · TypeScript · Tailwind CSS 3 · next/font (Space
Grotesk / Inter / JetBrains Mono) · Radix UI primitives · TanStack Query ·
react-hook-form + zod · Framer Motion · lucide-react · Storybook · Vitest +
Testing Library · Playwright + axe · ESLint + Prettier + Stylelint.

## Getting started

```bash
cd frontend
cp .env.local.example .env.local     # NEXT_PUBLIC_API_BASE_URL etc.
npm install
npm run dev                          # http://localhost:3000
```

Open **/style-guide** — the living style guide renders every design token and
component in light and dark (toggle in the header). The `GET /events` demo there
renders live once the backend is running (`docker compose up` at the repo root).

## Design system as the single source of truth

- **`styles/tokens.css`** is the ONLY file with raw values. Colours are stored
  as RGB channels (so opacity utilities work) in two layers: primitive brand
  ramps, and **semantic role tokens** (`--background`, `--primary`, `--border`,
  …) that remap per theme. Everything downstream references tokens by name.
- **`tailwind.config.ts`** is a thin projection of those tokens — utilities like
  `bg-primary`, `text-h1`, `rounded-xl`, `shadow-glow`, `duration-fast` all
  resolve to CSS variables. Swap a token and the whole app reskins.
- **Theming** (`lib/theme`) defaults to the system preference, persists an
  explicit toggle, and sets the theme class before hydration (no flash).
- **Enforced, no raw values:** a custom ESLint rule (`local-rules/no-raw-values`)
  fails the build on any hex colour or arbitrary px in TS/TSX; Stylelint's
  `color-no-hex` does the same for CSS. Try planting `#ff0000` — CI goes red.

## Performance baseline

- Server Components by default; Client Components only where interactive.
- Route-level `loading.tsx` skeletons; streaming via Suspense.
- `next/image` (AVIF/WebP), self-hosted fonts with `display: swap`,
  `optimizePackageImports` for icons.
- Web Vitals reporting wired (`lib/vitals`) with the budget **LCP < 2.5s,
  CLS < 0.1, INP < 200ms**; `npm run check:bundle` guards JS footprint in CI.
- SEO: Metadata API defaults, JSON-LD helpers (Event + BreadcrumbList),
  `sitemap.ts`, `robots.ts`.

## Data layer

`lib/api` — a typed fetch client (base URL from env, bearer auth with transparent
refresh-on-401, the backend error envelope → typed `ApiError`), a TanStack Query
provider with sane defaults, and hooks. Types are hand-aligned now; run
`npm run gen:api` to regenerate `lib/api/schema.d.ts` from the backend OpenAPI
schema once the contract is frozen.

## Scripts

| Command                                 | What                                                 |
| --------------------------------------- | ---------------------------------------------------- |
| `npm run dev` / `build` / `start`       | Next dev / prod build / serve                        |
| `npm run typecheck`                     | `tsc --noEmit`                                       |
| `npm run lint` / `lint:css`             | ESLint (incl. no-raw-values) / Stylelint             |
| `npm run test` / `test:coverage`        | Vitest + Testing Library                             |
| `npm run e2e`                           | Playwright smoke + axe (light + dark)                |
| `npm run storybook` / `build-storybook` | Component library                                    |
| `npm run check:bundle`                  | Bundle-size budget (run after `build`)               |
| `npm run gen:api`                       | Regenerate typed API from the backend OpenAPI schema |

## Structure

```
app/            layout, providers, home, style-guide, loading/error/not-found, sitemap/robots
components/ui/  primitives (Button, Input, Select, Modal, Toast, …) + stories + tests
components/shell/  Header (condensing, slots), Footer, BottomNav, Container, ThemeToggle
components/style-guide/  the living style-guide sections
lib/api/        typed client, query provider, hooks, types
lib/theme/      tokens bridge, fonts, ThemeProvider
lib/seo/ lib/vitals/  metadata, JSON-LD, web-vitals
styles/         tokens.css (source of truth) + globals.css
```

> The display face ships as **Space Grotesk** (a Design-System-sanctioned
> alternative to Satoshi, which isn't on Google Fonts). Swapping to real Satoshi
> later is a one-line change in `lib/theme/fonts.ts` — nothing else moves.
