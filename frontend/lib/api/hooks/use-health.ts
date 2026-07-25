'use client';

import { useQuery } from '@tanstack/react-query';
import { ping } from '../client';

/** Liveness of the backend — used by the style-guide connectivity indicator. */
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => ping(),
    staleTime: 30_000,
    retry: false,
  });
}
