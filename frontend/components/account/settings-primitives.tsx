import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * The card and the row every settings section is built from.
 *
 * ── SAME RECIPE AS `organizer/primitives.tsx`, ONE SIZE UP ────────────────
 *
 * `rounded-xl border border-border bg-surface shadow-sm` is the card recipe the
 * whole product uses — on a pure-white canvas `bg-surface` is the same value as
 * the page, so a card separates by hairline plus shadow, never by fill (see the
 * elevation note in styles/tokens.css). The one deliberate difference from
 * `Panel` is the title: `text-h4` rather than `text-body-sm`, because that
 * component is tuned for a nine-panel operations dashboard and this is one
 * attendee reading five rows on a phone. Everything else is shared, so the two
 * surfaces still look like the same product.
 *
 * ── A ROW IS A LABEL, A CONTROL AND A REASON ──────────────────────────────
 *
 * Label + control side by side once there is room, stacked below `sm`, and the
 * helper text sits under the LABEL rather than under the control — it explains
 * what the setting means, which is a property of the label. Rows are
 * `min-h-control` (44px, the touch-target floor) with `py-stack-lg`, so a thumb
 * always has a target even where the "control" is a single word of text.
 *
 * ── NO `<dl>` ─────────────────────────────────────────────────────────────
 *
 * A label/value pair is definition-list-shaped and this deliberately is not
 * one. §14.3 records a real 1.3.1 violation in this codebase from `dt`/`dd`
 * nested two levels below their `<dl>`, and these rows nest a control, a hint
 * and sometimes a form inside each side. Plain elements cannot fail that rule.
 */

export function SettingsCard({
  id,
  title,
  description,
  children,
  className,
}: {
  /** Used for the heading's id, so the section can be labelled by it. */
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className={cn('rounded-xl border border-border bg-surface shadow-sm', className)}
    >
      <header className="flex flex-col gap-1 border-b border-border px-card py-card lg:px-card-lg">
        <h2 id={`${id}-heading`} className="text-h4">
          {title}
        </h2>
        <p className="text-body-sm text-muted-foreground">{description}</p>
      </header>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

export function SettingsRow({
  label,
  labelFor,
  hint,
  children,
  stacked = false,
  className,
}: {
  label: string;
  /** Set when `children` contains exactly one labellable control. */
  labelFor?: string;
  hint?: React.ReactNode;
  children?: React.ReactNode;
  /**
   * Put the control BELOW the label instead of beside it. For anything wide —
   * a segmented group, a code field — which would otherwise squeeze against
   * the label at 360px and shrink below its own touch target.
   */
  stacked?: boolean;
  className?: string;
}) {
  const Label = labelFor ? 'label' : 'p';
  return (
    <div
      className={cn(
        'flex min-h-control flex-col gap-stack px-card py-stack-lg lg:px-card-lg',
        stacked ? '' : 'sm:flex-row sm:items-center sm:justify-between sm:gap-stack-lg',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <Label
          htmlFor={labelFor}
          className="text-body-sm font-semibold text-foreground [overflow-wrap:anywhere]"
        >
          {label}
        </Label>
        {hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}
      </div>
      {children ? (
        <div className={cn('flex min-w-0 flex-wrap items-center gap-stack', stacked ? '' : 'sm:justify-end')}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The value half of a read-only row.
 *
 * Read-only is the honest shape for most of this account record: `apps/accounts`
 * exposes register / login / refresh / logout / me and nothing that writes a
 * profile field. A disabled input holding a real email would read as "editing is
 * temporarily broken"; plain text reads as what it is.
 */
export function SettingsValue({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('min-w-0 text-body-sm text-foreground [overflow-wrap:anywhere]', className)}>
      {children}
    </span>
  );
}

/**
 * A recessed footnote at the end of a section.
 *
 * `bg-sunken` rather than another bordered card: these notes say what the data
 * model does NOT hold, and drawing one as a lifted card gives a gap the same
 * visual weight as the things that are true.
 */
export function SettingsNote({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('px-card py-stack-lg lg:px-card-lg', className)}>
      <p className="rounded-lg bg-sunken p-card text-caption text-muted-foreground">{children}</p>
    </div>
  );
}
