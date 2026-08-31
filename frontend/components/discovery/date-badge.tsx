import { formatDateParts, machineDate } from '@/lib/discovery/format';
import { cn } from '@/lib/utils/cn';

/**
 * The date, on the artwork.
 *
 * ── WHY IT SITS ON THE POSTER AND NOT UNDER THE TITLE ─────────────────────
 *
 * A discovery card answers two questions in the order people ask them: what is
 * it, and when. Written as a fourth line of text under the title, the "when"
 * competes with the venue and the price for the same grey and is read last —
 * and it is the line most likely to be truncated on a phone. On the artwork it
 * is read at the same moment as the picture, which is what a poster does.
 *
 * ── ONE COMPONENT, EVERY CARD ─────────────────────────────────────────────
 *
 * Both the featured carousel and the All Events rail render this rather than
 * each drawing its own square. Two hand-rolled badges is how one of them ends
 * up in a different corner, a different size, or with the month capitalised
 * differently — a difference nobody notices until the two are on screen
 * together, which on the home page they always are.
 *
 * Translucent rather than opaque: the artwork is the organiser's, and a solid
 * plate cut out of it reads as damage. `backdrop-blur` keeps the digits legible
 * over a busy photograph without hiding it.
 *
 * The machine-readable date is on a `<time>` element, so this is a real date to
 * anything parsing the page rather than two decorative numbers.
 */
export function DateBadge({
  startsAt,
  className,
}: {
  startsAt: string;
  className?: string;
}) {
  const { day, month } = formatDateParts(startsAt);

  return (
    <time
      dateTime={machineDate(startsAt)}
      className={cn(
        'pointer-events-none absolute z-10 flex min-w-11 flex-col items-center rounded-lg border border-white/15 bg-black/55 px-2 py-1 text-center leading-none text-white backdrop-blur-sm',
        className,
      )}
    >
      <span className="text-body font-extrabold tabular-nums">{day}</span>
      <span className="mt-0.5 text-[0.625rem] font-semibold uppercase tracking-wide opacity-90">
        {month}
      </span>
    </time>
  );
}
