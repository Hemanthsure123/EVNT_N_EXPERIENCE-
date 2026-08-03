import type { EventRow } from '@/lib/api/organizer';

/**
 * Can this event be submitted for approval, and if not, why not.
 *
 * PURE, and in `lib/` rather than beside the table, because THREE screens ask
 * the question — the events table's bulk bar, the row side panel's resubmit,
 * and (through `publishBlockers`) the creation wizard. When it lived in the
 * table, the panel had to import from the component that imports the panel,
 * which is a module cycle waiting to bite at initialisation time.
 */

/**
 * Mirrors the WHOLE publish gate, not just its source-state rule.
 *
 * ── THIS IS THE BUG ORGANIZERS ACTUALLY HIT ──────────────────────────────
 *
 * It used to check `status` alone. The wizard's own Submit button is correctly
 * disabled by `publishBlockers`, so an incomplete draft could not be submitted
 * from the screen that knew it was incomplete — but the SAME event was one
 * click away in the bulk bar, from a button that mirrored nothing. That is the
 * path that produced "cannot submit events for approval": the request went out,
 * the server refused it correctly, and the organizer got an error on a control
 * that had offered itself.
 *
 * A button certain to be refused is worse than a disabled one. Every clause
 * here corresponds to a real server-side gate, in the order the server applies
 * them (apps/events/services.py publish_event, then publish_checks.py):
 *
 *   1. verified organization  -> 403 organization_not_verified
 *   2. draft or rejected      -> 409 invalid_event_state
 *   3. a title and a venue    -> 409 event_not_publishable
 *   4. starts in the future   -> 409 event_not_publishable
 *   5. >= 1 ticket type       -> 409 event_not_publishable  (ticketing's check)
 *
 * Clause 4 matters more than it looks: a draft left alone long enough becomes
 * unpublishable purely by its start time passing, and nothing else on this
 * screen would say so.
 */
export const canSubmit = (row: EventRow) =>
  (row.status === 'draft' || row.status === 'rejected') &&
  row.organization_verified_level === 'verified' &&
  row.ticket_type_count > 0 &&
  Boolean(row.title.trim()) &&
  Boolean(row.venue.trim()) &&
  Date.parse(row.starts_at) > Date.now();

/** Why a selected row cannot be submitted — the same clauses, as sentences.
 *  Shown on the bulk bar so a disabled button explains itself. */
export function submitBlockers(row: EventRow): string[] {
  const out: string[] = [];
  if (row.status !== 'draft' && row.status !== 'rejected') {
    out.push('Only draft or sent-back events can be submitted.');
  }
  if (row.organization_verified_level !== 'verified') {
    out.push(
      row.organization_verified_level === 'pending'
        ? `${row.organization_name} is still being verified.`
        : `${row.organization_name} needs to be verified first.`,
    );
  }
  if (row.ticket_type_count === 0) out.push('Add at least one ticket type.');
  if (!row.title.trim()) out.push('Add a title.');
  if (!row.venue.trim()) out.push('Add a venue.');
  if (Date.parse(row.starts_at) <= Date.now()) out.push('The start time has already passed.');
  return out;
}
