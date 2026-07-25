'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { isApiError } from './errors';

/**
 * TanStack Query with sane defaults: a short stale time (fast, but revalidates),
 * no refetch-on-focus thrash, and a retry policy that NEVER retries 4xx client
 * errors (a 404/403/422 won't get better by retrying) but does retry transient
 * failures a couple of times.
 */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (isApiError(error) && error.isClientError) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // One client per browser session (kept stable across renders).
  const [client] = React.useState(makeQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
