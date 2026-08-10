import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo/metadata';
import { ComponentGallery } from '@/components/style-guide/component-gallery';
import { EventsDemo } from '@/components/style-guide/events-demo';
import { Section } from '@/components/style-guide/section';
import { TokensShowcase } from '@/components/style-guide/tokens-showcase';
import { Container } from '@/components/shell/container';
import { Footer } from '@/components/shell/footer';
import { Header } from '@/components/shell/header';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { Badge } from '@/components/ui/badge';

export const metadata: Metadata = {
  ...pageMetadata(
    'Style guide',
    'The living design system — every token and component, in light and dark.',
  ),
  /**
   * Internal documentation, on the public domain.
   *
   * It was not merely reachable — it was listed in `app/sitemap.ts`, so the
   * design system was being SUBMITTED to Google alongside the event pages. A
   * search result for the product that lands on a swatch grid is a worse first
   * impression than no result, and the page competes with real content for
   * crawl budget on a site whose event pages are not in the sitemap at all yet.
   *
   * Left routable on purpose (the axe sweep scans it, and it is genuinely
   * useful in review), but out of the index and out of the sitemap.
   */
  robots: { index: false, follow: false },
};

const NAV = [
  { href: '#colours', label: 'Colour' },
  { href: '#type', label: 'Type' },
  { href: '#spacing', label: 'Spacing' },
  { href: '#buttons', label: 'Components' },
  { href: '#data', label: 'Data' },
];

export default function StyleGuidePage() {
  return (
    <>
      <Header
        // In-page anchors, not routes — so this is a plain `<nav>` rather than
        // the site header's `NavRail`, whose sliding pill tracks a pathname
        // that never changes here.
        nav={
          <nav aria-label="Style guide sections" className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-full px-3 py-2 text-body-sm font-medium text-muted-foreground transition-colors duration-fast ease-out hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {item.label}
              </a>
            ))}
          </nav>
        }
        actions={<ThemeToggle />}
      />
      <main>
        <Container className="flex flex-col gap-16 py-12">
          <header className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="primary">Design system v1.0</Badge>
              <Badge variant="outline">Light + dark</Badge>
              <Badge variant="outline">Token-driven</Badge>
            </div>
            <h1 className="text-h1 md:text-display">Living style guide</h1>
            <p className="max-w-2xl text-body-lg text-muted-foreground">
              Every foundation token and core component, driven entirely by CSS variables. Use the
              theme toggle in the header to preview everything in light and dark — the whole page
              reskins from the tokens alone.
            </p>
          </header>

          <TokensShowcase />
          <ComponentGallery />

          <Section
            id="data"
            title="Data layer"
            description="Proof of the typed API client + TanStack Query: a read-only GET /events rendered as cards, with a live backend-connectivity indicator."
          >
            <EventsDemo />
          </Section>
        </Container>
      </main>
      <Footer />
    </>
  );
}
