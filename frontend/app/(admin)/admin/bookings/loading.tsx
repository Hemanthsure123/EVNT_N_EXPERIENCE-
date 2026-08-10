/**
 * Route-level loading state. See `components/organizer/skeletons.tsx`.
 */
import { ConsoleTableSkeleton } from '@/components/organizer/skeletons';

export default function Loading() {
  return <ConsoleTableSkeleton label="Loading bookings" columns={7} />;
}
