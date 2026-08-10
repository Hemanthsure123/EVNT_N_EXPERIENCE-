/** Route-level loading state. See `components/organizer/skeletons.tsx`. */
import { ConsoleQueueSkeleton } from '@/components/organizer/skeletons';

export default function Loading() {
  return <ConsoleQueueSkeleton label="Loading refund requests" />;
}
