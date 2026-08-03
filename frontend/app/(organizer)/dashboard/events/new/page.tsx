import * as React from 'react';
import type { Metadata } from 'next';
import { EventWizard } from '@/components/organizer/wizard/event-wizard';

export const metadata: Metadata = { title: 'Create event' };

/**
 * The wizard is a client component from its root: it is an editor, and every
 * part of it (autosave, undo, the live preview, drag-to-reorder) depends on
 * state that only exists in the browser. There is nothing here a server
 * component could usefully render — the draft does not exist on the server
 * until the organizer has typed enough for `POST /events` to accept it.
 */
export default function CreateEventPage() {
  return <EventWizard />;
}
