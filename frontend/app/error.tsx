'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // In production this would report to an error tracker.
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-warning-subtle text-warning-subtle-foreground">
        <AlertTriangle className="size-7" aria-hidden />
      </span>
      <h1 className="text-h2">Something went wrong</h1>
      <p className="text-body-sm text-muted-foreground">
        An unexpected error occurred. You can try again — if it keeps happening, please let us know.
      </p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
