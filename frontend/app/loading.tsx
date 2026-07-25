import { Skeleton } from '@/components/ui/skeleton';

/** Route-level loading skeleton, shaped like real content (streamed via Suspense). */
export default function Loading() {
  return (
    <div className="mx-auto flex max-w-container flex-col gap-6 px-4 py-16">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-5 w-full max-w-md" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-56 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
