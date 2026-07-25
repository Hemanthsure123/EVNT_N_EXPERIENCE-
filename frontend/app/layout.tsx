import type { Metadata, Viewport } from 'next';
import { defaultMetadata } from '@/lib/seo/metadata';
import { fontClassNames } from '@/lib/theme/fonts';
import { themeInitScript } from '@/lib/theme/theme-provider';
import { WebVitals } from '@/lib/vitals/web-vitals';
import { Providers } from './providers';
import '@/styles/globals.css';

export const metadata: Metadata = defaultMetadata;

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Set the theme class before hydration to avoid a flash of wrong theme. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={`${fontClassNames} min-h-dvh bg-background font-sans text-body text-foreground antialiased`}
      >
        <Providers>{children}</Providers>
        <WebVitals />
      </body>
    </html>
  );
}
