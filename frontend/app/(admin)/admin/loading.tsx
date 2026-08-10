/**
 * Route-level loading state.
 *
 * The three consoles had NO `loading.tsx` anywhere — every screen went from the
 * previous page straight to a blank region while its queries resolved, on the
 * slowest pages in the product. Shaped like the real page rather than a
 * spinner, so nothing shifts when the content lands. See
 * `components/organizer/skeletons.tsx`.
 */
import { ConsoleHomeSkeleton } from '@/components/organizer/skeletons';

export default function Loading() {
  return <ConsoleHomeSkeleton label="Loading the operations overview" />;
}
