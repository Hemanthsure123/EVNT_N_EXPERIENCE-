'use client';

import * as React from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  GripVertical,
  Plus,
  Ticket,
  Trash2,
} from 'lucide-react';
import type { EventSlot } from '@/lib/api/event-content';
import { formatMoney } from '@/lib/discovery/format';
import {
  MAX_PHASES,
  newPhase,
  newTier,
  type DraftPhase,
  type DraftTier,
} from '@/lib/organizer/wizard/model';
import { Button, Input } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { EmptyState } from '../primitives';

/**
 * The ticket builder — cards, not one long form.
 *
 * ── DRAG-AND-DROP, WITHOUT A LIBRARY ──────────────────────────────────────
 *
 * Reordering is the HTML drag-and-drop API plus a `dragover` swap. A drag
 * library would be ~15KB gzipped on a route that already carries the wizard,
 * for a list that is realistically three to six items. It also has a keyboard
 * path (the ↑/↓ buttons on each card), which is not an afterthought: native
 * HTML5 drag is entirely unusable without a pointer, so a drag-only reorder
 * would make tier ordering keyboard-inaccessible.
 *
 * ── WHAT ORDER ACTUALLY MEANS ─────────────────────────────────────────────
 *
 * The backend has no `position` column on `TicketType`, and the public tiers
 * endpoint returns them ordered by PRICE. So dragging changes the order in
 * this editor only — it does not change what a buyer sees, and the panel says
 * so rather than implying a merchandising control that does not exist.
 * `BACKLOG.md` covers the column it would need.
 *
 * ── DELETE VS REMOVE ──────────────────────────────────────────────────────
 *
 * A tier that has not been saved can be removed outright. One that HAS been
 * saved cannot: `apps/ticketing` exposes no DELETE, correctly — a tier with
 * sales is referenced by issued tickets and by the settlement that pays them
 * out. The card says that plainly instead of offering a button that 404s.
 *
 * ── THE ROW WRAPS RATHER THAN SHRINKING ITS CONTROLS ──────────────────────
 *
 * Six things sit on a tier row and every one of the four buttons is a full 44px
 * circle. That does not fit on one line at 390px, so the row WRAPS there and
 * the controls take a second line. The alternative — 28px icons on the row that
 * deletes a ticket tier — trades the touch target for a tidier screenshot.
 *
 * ── REORDER IS NOT A PRIMARY ACTION, SO IT IS NOT A FILLED BUTTON ─────────
 *
 * Add and duplicate are `outline` and `ghost`; the one filled pill on the
 * tickets step is the wizard footer's Next.
 *
 * ── PRICING PHASES ARE PART OF THE TIER, SO THEY LIVE INSIDE ITS CARD ─────
 *
 * A phase is a step in ONE tier's price, not a sibling of the tier, and the
 * schedule is written as part of the tier's own PATCH (array order is position —
 * see `SalePhaseInput`). So the repeater is inside the expanded card, built from
 * the same `Field` primitive as the six fields above it, and each row can only
 * be removed — there is no per-phase save to get out of step, because the whole
 * schedule is replaced on every write.
 *
 * The seat cap is the field an organizer will otherwise get wrong, so the panel
 * states BOTH of the backend's actual rules: the cap is CUMULATIVE (the first N
 * seats of the tier, not N seats set aside at this price), and an order that
 * straddles it pays the NEXT phase's price for the whole order rather than being
 * split. Neither is guessable from the label, and both change what the organizer
 * would type.
 */

export function TicketBuilder({
  tiers,
  onChange,
  issues,
  sessions = [],
}: {
  tiers: DraftTier[];
  onChange: (next: DraftTier[]) => void;
  issues: Map<string, string[]>;
  /**
   * The event's sessions, when it runs more than once. Empty is the common
   * case and the session field does not render at all — asking "which
   * showtime" of an event with one showtime is a field whose only possible
   * answer is the one already true.
   */
  sessions?: EventSlot[];
}) {
  const [open, setOpen] = React.useState<string | null>(null);
  const dragging = React.useRef<number | null>(null);
  const [dragOver, setDragOver] = React.useState<number | null>(null);

  const patch = (key: string, changes: Partial<DraftTier>) =>
    onChange(tiers.map((tier) => (tier.key === key ? { ...tier, ...changes } : tier)));

  const move = (from: number, to: number) => {
    if (to < 0 || to >= tiers.length || from === to) return;
    const next = [...tiers];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  const add = () => {
    const tier = newTier(tiers.length);
    onChange([...tiers, tier]);
    setOpen(tier.key);
  };

  const duplicate = (index: number) => {
    const source = tiers[index];
    // A copy is a NEW tier: it must not inherit the original's server id or
    // version, or the first autosave would PATCH the original instead of
    // creating a second one.
    const copy: DraftTier = {
      ...source,
      key: newTier(tiers.length).key,
      serverId: undefined,
      version: undefined,
      name: `${source.name} (copy)`.trim(),
    };
    const next = [...tiers];
    next.splice(index + 1, 0, copy);
    onChange(next);
    setOpen(copy.key);
  };

  if (tiers.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface shadow-sm">
        <EmptyState
          icon={Ticket}
          title="No tickets yet"
          body="At least one ticket type is required before you can publish."
          action={
            <Button
              variant="outline"
              onClick={add}
              leftIcon={<Plus className="size-4" aria-hidden />}
            >
              Add your first ticket
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-stack">
      <ul className="flex flex-col gap-2">
        {tiers.map((tier, index) => {
          const problems = issues.get(tier.key) ?? [];
          const expanded = open === tier.key;
          return (
            <li
              key={tier.key}
              draggable
              onDragStart={(event) => {
                dragging.current = index;
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(index);
              }}
              onDragEnd={() => {
                dragging.current = null;
                setDragOver(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging.current !== null) move(dragging.current, index);
                dragging.current = null;
                setDragOver(null);
              }}
              className={cn(
                'rounded-xl border bg-surface shadow-sm transition-all duration-fast',
                'motion-reduce:transition-none',
                problems.length ? 'border-destructive' : 'border-border',
                dragOver === index && dragging.current !== index && 'ring-2 ring-primary',
                dragging.current === index && 'opacity-50',
              )}
            >
              {/* Wraps at narrow widths rather than shrinking the controls:
                  the six things on this row cannot all be 44px on a 390px
                  screen in ONE line, and a 28px trash icon on the money path is
                  the wrong thing to trade away. Above `sm` it is one line. */}
              <div className="flex flex-wrap items-center gap-1 p-stack">
                <span className="cursor-grab text-foreground-subtle active:cursor-grabbing" aria-hidden>
                  <GripVertical className="size-4" />
                </span>

                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : tier.key)}
                  aria-expanded={expanded}
                  className="flex min-h-control min-w-0 flex-1 basis-48 items-center gap-2 rounded-lg px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-sm font-medium">
                      {tier.name || `Ticket ${index + 1}`}
                    </span>
                    <span className="block truncate text-caption tabular-nums text-muted-foreground">
                      {tier.price === ''
                        ? 'No price set'
                        : formatMoney(Math.round(Number(tier.price) * 100))}
                      {tier.quantity ? ` · ${tier.quantity} available` : ''}
                      {/* A schedule is invisible once the card is collapsed, and
                          it is the thing most likely to be half-finished. */}
                      {tier.phases.length
                        ? ` · ${tier.phases.length} pricing phase${tier.phases.length === 1 ? '' : 's'}`
                        : ''}
                      {tier.serverId ? ' · saved' : ''}
                    </span>
                  </span>
                  <ChevronDown
                    className={cn(
                      'size-4 shrink-0 text-muted-foreground transition-transform duration-fast',
                      expanded && 'rotate-180',
                    )}
                    aria-hidden
                  />
                </button>

                <div className="ml-auto flex shrink-0 items-center gap-0.5">
                  <IconButton
                    label={`Move ${tier.name || `ticket ${index + 1}`} up`}
                    disabled={index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    <ArrowUp className="size-4" aria-hidden />
                  </IconButton>
                  <IconButton
                    label={`Move ${tier.name || `ticket ${index + 1}`} down`}
                    disabled={index === tiers.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowDown className="size-4" aria-hidden />
                  </IconButton>
                  <IconButton
                    label={`Duplicate ${tier.name || `ticket ${index + 1}`}`}
                    onClick={() => duplicate(index)}
                  >
                    <Copy className="size-4" aria-hidden />
                  </IconButton>
                  {/* A real divider, so Remove never abuts Duplicate. A remove
                      flush against a copy is the click people regret, and on a
                      ticket tier that regret has a price. */}
                  <span className="mx-0.5 h-6 w-px shrink-0 bg-border" aria-hidden />
                  {!tier.serverId ? (
                    <IconButton
                      destructive
                      label={`Remove ${tier.name || `ticket ${index + 1}`}`}
                      onClick={() =>
                        onChange(tiers.filter((candidate) => candidate.key !== tier.key))
                      }
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </IconButton>
                  ) : (
                    <span
                      title="Saved tiers cannot be deleted — they may already have sales attached"
                      className="inline-flex size-control items-center justify-center text-success-subtle-foreground"
                    >
                      <Check className="size-4" aria-hidden />
                      <span className="sr-only">Saved</span>
                    </span>
                  )}
                </div>
              </div>

              {expanded ? (
                <div className="border-t border-border bg-sunken p-card">
                  <div className="grid gap-stack-lg sm:grid-cols-2">
                    <Field
                      label="Name"
                      id={`${tier.key}-name`}
                      value={tier.name}
                      onChange={(value) => patch(tier.key, { name: value })}
                      placeholder="General Admission"
                    />
                    <Field
                      label="What it is"
                      id={`${tier.key}-description`}
                      value={tier.description}
                      onChange={(value) => patch(tier.key, { description: value })}
                      placeholder="Standing, front of the barrier"
                    />
                    <Field
                      label="Price (₹)"
                      id={`${tier.key}-price`}
                      value={tier.price}
                      onChange={(value) => patch(tier.key, { price: value })}
                      type="number"
                      min="0"
                      placeholder="499"
                      hint="0 makes it a free ticket."
                    />
                    <Field
                      label="Quantity"
                      id={`${tier.key}-qty`}
                      value={tier.quantity}
                      onChange={(value) => patch(tier.key, { quantity: value })}
                      type="number"
                      min="1"
                      placeholder="100"
                      hint="The hard cap. Overselling is impossible below it."
                    />
                    {sessions.length ? (
                      <SessionField
                        tier={tier}
                        sessions={sessions}
                        onChange={(slotId) => patch(tier.key, { slotId })}
                      />
                    ) : null}
                    <Field
                      label="Max per order"
                      id={`${tier.key}-max`}
                      value={tier.maxPerOrder}
                      onChange={(value) => patch(tier.key, { maxPerOrder: value })}
                      type="number"
                      min="1"
                    />
                    <Field
                      label="Sales start"
                      id={`${tier.key}-start`}
                      value={tier.saleStart}
                      onChange={(value) => patch(tier.key, { saleStart: value })}
                      type="datetime-local"
                      hint="Leave blank to sell immediately."
                    />
                    <Field
                      label="Sales end"
                      id={`${tier.key}-end`}
                      value={tier.saleEnd}
                      onChange={(value) => patch(tier.key, { saleEnd: value })}
                      type="datetime-local"
                      hint="Leave blank to sell until the event starts."
                    />
                  </div>


                  <PhaseEditor tier={tier} onChange={(phases) => patch(tier.key, { phases })} />

                  {problems.length ? (
                    <ul className="mt-stack-lg flex flex-col gap-1" role="alert">
                      {problems.map((problem) => (
                        <li key={problem} className="text-caption text-destructive">
                          {problem}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {/* A footnote here said description and perks were not
                      stored — which was true when it was written and is now
                      contradicted by the two editors directly above it, both
                      of which write real columns. That is the failure mode of
                      engineering copy in a product surface: it does not fail
                      loudly, it just quietly starts lying.

                      What remains genuinely absent is a per-tier refundable
                      flag; refunds act on a booking, and the organiser learns
                      that where they act on one rather than in a caption on a
                      form. */}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-stack">
        <Button variant="outline" onClick={add} leftIcon={<Plus className="size-4" aria-hidden />}>
          Add ticket
        </Button>
        <p className="text-caption text-muted-foreground">
          Drag, or use ↑ ↓, to reorder them here. Buyers always see tiers cheapest first.
        </p>
      </div>
    </div>
  );
}

/**
 * The sale-phase schedule for one tier.
 *
 * Ordered top to bottom, which IS the position the write sends — so the note
 * says so rather than leaving somebody to discover that dragging is the only
 * thing missing. There is no reorder control and no per-phase save: the schedule
 * is submitted whole, and a phase has no server identity to preserve.
 *
 * Every rule the schedule has to satisfy is reported by `phaseIssues` into the
 * card's existing error list below these fields, so this component holds no
 * validation of its own — one statement of the rules, in the module the save
 * engine also consults.
 */
function PhaseEditor({
  tier,
  onChange,
}: {
  tier: DraftTier;
  onChange: (phases: DraftPhase[]) => void;
}) {
  const phases = tier.phases;
  const atLimit = phases.length >= MAX_PHASES;

  const update = (key: string, changes: Partial<DraftPhase>) =>
    onChange(phases.map((phase) => (phase.key === key ? { ...phase, ...changes } : phase)));

  return (
    <section className="mt-stack-lg flex flex-col gap-stack border-t border-border pt-stack-lg">
      <div className="flex flex-wrap items-start justify-between gap-stack">
        <div className="flex min-w-0 flex-col gap-1">
          <h4 className="text-body-sm font-medium text-foreground">Pricing phases</h4>
          <p className="text-caption text-muted-foreground">
            Optional. Sell the first seats cheaper, then step the price up. Buyers see the
            live phase price with the normal price struck through.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={atLimit}
          onClick={() => onChange([...phases, newPhase(phases.length)])}
          leftIcon={<Plus className="size-4" aria-hidden />}
        >
          Add pricing phase
        </Button>
      </div>

      {phases.length ? (
        <ul className="flex flex-col gap-stack">
          {phases.map((phase, index) => (
            <li
              key={phase.key}
              className="flex flex-col gap-stack rounded-lg border border-border bg-surface p-stack"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-caption font-medium text-muted-foreground">
                  {/* The position, which is what decides the order these apply
                      in — not a name, which may well still be blank. */}
                  Phase {index + 1} of {phases.length}
                </span>
                <IconButton
                  destructive
                  label={`Remove phase ${index + 1} from ${tier.name || 'this ticket'}`}
                  onClick={() =>
                    onChange(phases.filter((candidate) => candidate.key !== phase.key))
                  }
                >
                  <Trash2 className="size-4" aria-hidden />
                </IconButton>
              </div>
              <div className="grid gap-stack-lg sm:grid-cols-2">
                <Field
                  label="Name"
                  id={`${phase.key}-name`}
                  value={phase.name}
                  onChange={(value) => update(phase.key, { name: value })}
                  // A suggestion, not a default: the placeholder is what most
                  // organizers call these, and it disappears the moment they
                  // call theirs something else.
                  placeholder={index === 0 ? 'Early bird' : `Phase ${index}`}
                  hint="Buyers see this on the ticket and on their order."
                />
                <Field
                  label="Price (₹)"
                  id={`${phase.key}-price`}
                  value={phase.price}
                  onChange={(value) => update(phase.key, { price: value })}
                  type="number"
                  min="1"
                  placeholder="399"
                  hint="At or below the normal price, and never cheaper than the phase above."
                />
                <Field
                  label="Ends at"
                  id={`${phase.key}-ends`}
                  value={phase.endsAt}
                  onChange={(value) => update(phase.key, { endsAt: value })}
                  type="datetime-local"
                  hint="Leave blank to end it on the seat cap alone."
                />
                <Field
                  label="Seat cap"
                  id={`${phase.key}-qty`}
                  value={phase.quantity}
                  onChange={(value) => update(phase.key, { quantity: value })}
                  type="number"
                  min="1"
                  placeholder="100"
                  hint="Cumulative — see below. Leave blank to end it on the time alone."
                />
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        The two rules that decide whether the seat cap means what the organizer
        thinks it means. Both are the backend's actual behaviour
        (`apps/ticketing/pricing.py`), and neither is guessable from the label —
        an organizer reading "Seat cap: 100" reasonably assumes 100 seats are set
        aside at this price, and that a 3-ticket order taking the last one would
        get one cheap seat and two at the next price. Both assumptions are wrong,
        and both cost them money.
      */}
      {/* ── THE ONE FACT THAT COSTS MONEY IF MISREAD ──────────────────────
          Three paragraphs stood here explaining phase ordering, the cumulative
          cap and whole-order pricing. They went, per the brief — but not the
          cap semantics, which are the one thing no label can imply and the one
          thing an organizer loses money by assuming: "Seat cap: 100" reads as
          "100 seats at this price" and actually means "the first 100 seats
          sold or held". A wrong guess there misprices the tier.
          So it is a short line beside the field it qualifies, not prose above
          the section — which is what "tooltips only where genuinely necessary"
          means in practice. */}
      <div className="flex flex-col gap-1 text-caption text-muted-foreground">
        <p>
          Caps are <strong className="font-medium text-foreground">cumulative</strong> — the first
          N seats sold or held, not N seats at this price. An order crossing a cap pays the next
          phase&apos;s price in full.
        </p>
        {atLimit ? <p>That is the limit of {MAX_PHASES} phases.</p> : null}
      </div>
    </section>
  );
}

/**
 * A row control — a full 44px circle, never a shrunken one.
 *
 * The ↑ / ↓ pair used to be the literal characters "↑" and "↓", which pick up
 * whatever arrow glyph the platform's fallback font supplies and land at a
 * different size and baseline beside the lucide icons next to them. They are
 * icons now, like everything else on the row.
 *
 * `destructive` reaches for the destructive tint on hover only; the separation
 * from the routine controls is a real divider rule drawn beside it, because a
 * `border-l` on a `rounded-full` button draws a curved arc, not a divider.
 */
function IconButton({
  label,
  onClick,
  disabled,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-control items-center justify-center rounded-full transition-colors duration-fast',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:opacity-40 disabled:hover:bg-transparent',
        destructive
          ? 'text-muted-foreground hover:bg-destructive-subtle hover:text-destructive-subtle-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  id,
  value,
  onChange,
  type = 'text',
  placeholder,
  hint,
  min,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
  min?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-caption font-medium text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        type={type}
        min={min}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        // Money and counts are compared down a column, so they get the
        // fixed-width figures every number in this console uses.
        className={cn(type === 'number' && 'tabular-nums')}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-caption text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const SESSION_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
};

/**
 * Which showtime this tier sells.
 *
 * LOCKED ONCE THE TIER EXISTS. Inventory lives on the tier row, and after a
 * sale so do issued tickets — moving the row to another session would re-point
 * somebody's ticket at a different evening. The server's editable set refuses
 * it for the same reason, so this is the boundary agreeing with the rule
 * rather than a second one.
 *
 * "Every session" is a real option, not a blank: a tier with no session admits
 * across the whole event, which is exactly what the gate does with it (the
 * scan window falls back to the event's own span). A season pass is that
 * ticket.
 */
function SessionField({
  tier,
  sessions,
  onChange,
}: {
  tier: DraftTier;
  sessions: EventSlot[];
  onChange: (slotId: string) => void;
}) {
  const id = `${tier.key}-session`;
  const locked = Boolean(tier.serverId);
  const chosen = sessions.find((session) => session.id === tier.slotId);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-body-sm font-medium">
        Session
      </label>
      {locked ? (
        // Not a disabled select: a greyed control invites clicking at it. The
        // decision is shown as the fact it now is.
        <>
          <p
            id={id}
            className="flex h-control items-center rounded-md border border-border bg-muted px-2.5 text-body text-foreground"
          >
            {chosen ? sessionLabel(chosen) : 'Every session'}
          </p>
          <p className="text-caption text-muted-foreground">
            Fixed once the tier is created — tickets are issued against it. Add a new tier to sell
            a different session.
          </p>
        </>
      ) : (
        <>
          <select
            id={id}
            value={tier.slotId ?? ''}
            onChange={(event) => onChange(event.target.value)}
            className="h-control rounded-md border border-input bg-surface px-2.5 text-body text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <option value="">Every session</option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id} disabled={!session.is_active}>
                {sessionLabel(session)}
                {session.is_active ? '' : ' — not selling'}
              </option>
            ))}
          </select>
          <p className="text-caption text-muted-foreground">
            Each session counts its own stock, so this tier can sell out without touching the
            others.
          </p>
        </>
      )}
    </div>
  );
}

function sessionLabel(session: EventSlot): string {
  const at = new Date(session.starts_at);
  const when = Number.isNaN(at.valueOf())
    ? session.starts_at
    : at.toLocaleString('en-IN', SESSION_FORMAT);
  return session.label ? `${when} · ${session.label}` : when;
}

/** `MAX_PERKS` in `apps/ticketing/schemas.py`, mirrored so the studio refuses
 *  what the server would rather than surfacing a 400 after a save. */
