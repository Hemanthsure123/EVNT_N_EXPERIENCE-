import { api } from './client';

/**
 * Google Calendar connection and sync.
 *
 * ── THE CLIENT NEVER SEES A TOKEN ─────────────────────────────────────────
 *
 * No access token, refresh token or client secret crosses this boundary. The
 * browser gets a URL to visit and a status to render; the backend holds the
 * grant, encrypted, and does every write. A refresh token in a JavaScript
 * bundle would be a permanent key to somebody's calendar.
 */

export type CalendarConnection = {
  account_email: string;
  status: 'active' | 'needs_reconnect';
  status_detail: string;
  connected: boolean;
  needs_reconnect: boolean;
  /** Consent can be given with the calendar box unticked — this is that. */
  calendar_enabled: boolean;
  connected_at: string;
  last_synced_at: string | null;
};

export type CalendarStatus = {
  /** Whether the DEPLOYMENT has OAuth credentials. Not about this user. */
  available: boolean;
  connection: CalendarConnection | null;
};

export const fetchCalendarStatus = () =>
  api.get<CalendarStatus>('/me/integrations/google');

/** Returns the URL to send the browser to. Does not redirect it. */
export const startCalendarConnect = () =>
  api.post<{ authorization_url: string }>('/me/integrations/google/connect', {});

export const disconnectCalendar = () =>
  api.delete<void>('/me/integrations/google/connect');

export const addBookingToCalendar = (bookingId: string) =>
  api.post<{ google_event_id: string }>('/me/calendar/events', { booking_id: bookingId });

export const removeBookingFromCalendar = (bookingId: string) =>
  api.delete<void>('/me/calendar/events', { body: { booking_id: bookingId } });

/**
 * What the "add to calendar" button should do about an error.
 *
 * The backend returns a distinct status and code for each outcome
 * (`apps/integrations/api.py`), so the UI can offer the right next step
 * instead of "something went wrong":
 *
 *   404 calendar_not_connected      -> offer to connect
 *   409 calendar_reconnect_required -> the grant lapsed; offer to reconnect
 *   403 oauth_insufficient_scope    -> they unticked calendar; reconnect
 *   502 calendar_sync_failed        -> Google is unhappy; offer a retry
 */
export type CalendarActionNeeded = 'connect' | 'reconnect' | 'retry' | 'none';

export function actionForError(code: string | undefined): CalendarActionNeeded {
  switch (code) {
    case 'calendar_not_connected':
      return 'connect';
    case 'calendar_reconnect_required':
    case 'oauth_insufficient_scope':
      return 'reconnect';
    case 'calendar_sync_failed':
      return 'retry';
    default:
      return 'none';
  }
}
