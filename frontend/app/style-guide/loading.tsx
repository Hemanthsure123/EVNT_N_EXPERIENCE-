import { Container } from '@/components/shell/container';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <Container className="flex flex-col gap-8 py-12">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-6 w-full max-w-2xl" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
    </Container>
  );
}
