import type { Metadata } from 'next';
import { CrewRoster } from '@/components/organizer/crew';

export const metadata: Metadata = { title: 'Crew' };

/**
 * The people an organizer puts on stage.
 *
 * Its own section rather than a tab inside an event, because the roster is
 * REUSED: add a resident DJ once and pick them for every night. The event
 * wizard only chooses from this list; it never creates the people.
 */
export default function OrganizerCrewPage() {
  return <CrewRoster />;
}
