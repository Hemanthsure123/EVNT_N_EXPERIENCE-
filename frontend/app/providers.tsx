'use client';

import * as React from 'react';
import { QueryProvider } from '@/lib/api/query-provider';
import { ThemeProvider } from '@/lib/theme/theme-provider';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';

/** Client-side provider stack mounted once at the root layout. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <QueryProvider>
        <TooltipProvider delayDuration={200} skipDelayDuration={300}>
          <ToastProvider>{children}</ToastProvider>
        </TooltipProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
