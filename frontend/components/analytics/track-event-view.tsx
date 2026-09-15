'use client';

import * as React from 'react';
import { recordView } from '@/lib/analytics/engagement';

/**
 * One view of one event, recorded when this mounts or the event changes.
 *
 * Rendered by the event route and by the mobile event widget. The mobile
 * arrival mounts both — the page, and the widget over it — and the
 * per-event-per-tab window in `recordView` is what makes that one view. It
 * records nothing outside the public site, where `EngagementTracker` has not
 * armed counting: a preview inside the organizer dashboard is not an audience.
 */
export function TrackEventView({ eventId }: { eventId: string }) {
  React.useEffect(() => {
    recordView(eventId);
  }, [eventId]);
  return null;
}
