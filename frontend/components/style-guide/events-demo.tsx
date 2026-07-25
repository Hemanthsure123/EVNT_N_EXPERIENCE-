'use client';

import { CalendarDays, MapPin, Ticket, WifiOff } from 'lucide-react';
import { errorMessage } from '@/lib/api/errors';
import { useEvents } from '@/lib/api/hooks/use-events';
import { useHealth } from '@/lib/api/hooks/use-health';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatPrice(minor: number | null): string {
  if (minor == null) return 'Free';
  return `from ₹${(minor / 100).toLocaleString('en-IN')}`;
}

/**
 * Proof of the typed data layer: a read-only GET /events rendered as cards, with
 * a live backend-connectivity indicator. Renders a helpful empty/offline state
 * when the backend isn't running (`docker compose up` to see live data).
 */
export function EventsDemo() {
  const health = useHealth();
  const { data, isLoading, isError, error } = useEvents();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span
          className={`size-2 rounded-full ${health.data ? 'bg-success' : 'bg-muted-foreground'}`}
          aria-hidden
        />
        <span className="text-body-sm text-muted-foreground">
          Backend: {health.isLoading ? 'checking…' : health.data ? 'connected' : 'not reachable'}
        </span>
      </div>

      {isError ? (
        <Alert variant="warning" icon={<WifiOff className="size-5" aria-hidden />}>
          <AlertTitle>Couldn&rsquo;t load events</AlertTitle>
          <AlertDescription>
            {errorMessage(error)} — start the backend with{' '}
            <code className="font-mono">docker compose up</code> to see live data.
          </AlertDescription>
        </Alert>
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3">
              <Skeleton className="aspect-video rounded-xl" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          icon={<Ticket className="size-8" aria-hidden />}
          title="No events yet"
          description="When the backend has published events, they'll render here as typed EventCards."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.data.map((event) => (
            <li key={event.id}>
              <Card interactive className="h-full overflow-hidden">
                <div className="aspect-video bg-gradient-royal" aria-hidden />
                <CardContent className="flex flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="line-clamp-2 text-h4">{event.title}</h4>
                    <Badge variant="primary" className="shrink-0">
                      {formatPrice(event.from_price)}
                    </Badge>
                  </div>
                  <p className="flex items-center gap-1.5 text-body-sm text-muted-foreground">
                    <CalendarDays className="size-4" aria-hidden />
                    {formatDate(event.starts_at)}
                  </p>
                  <p className="flex items-center gap-1.5 text-body-sm text-muted-foreground">
                    <MapPin className="size-4" aria-hidden />
                    {event.venue}, {event.city}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
