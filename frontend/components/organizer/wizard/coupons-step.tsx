'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgePercent, Plus, Trash2 } from 'lucide-react';
import {
  createCoupon,
  deleteCoupon,
  fetchCoupons,
  updateCoupon,
  type Coupon,
  type CouponKind,
} from '@/lib/api/coupons';
import { errorMessage } from '@/lib/api/errors';
import { formatMoney } from '@/lib/discovery/format';
import { Button, Input, Label } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils/cn';
import type { Draft } from '@/lib/organizer/wizard/model';
import { AccordionCard, NeedsSavedDraft, type DraftSave } from './fields';

/**
 * PROMO CODES, IN THE PIPELINE THAT CREATES THE EVENT THEY DISCOUNT.
 *
 * ── WHY IT IS HERE AT ALL ────────────────────────────────────────────────
 *
 * `/dashboard/promotions` owns codes for an ORGANISATION and is the right
 * home for a season pass or a partner code. An early-bird for THIS event is a
 * decision made while pricing this event, and sending somebody to another
 * screen mid-wizard to make it is how it gets made later or not at all.
 *
 * ── IT NEEDS A SAVED DRAFT, AND THAT IS NOT A LIMITATION OF THIS SCREEN ──
 *
 * A coupon is created with `event_id`, and an event that has never been saved
 * has no id to give. So this follows the same rule the gallery, the FAQs and
 * the running order already follow: say which field unlocks it, rather than
 * render a form whose Save can only 404. The unlock is a title — that is what
 * `POST /events` needs — and the draft saves itself the moment one is typed.
 *
 * ── THE FORM IS SMALLER THAN THE ONE ON PROMOTIONS, ON PURPOSE ───────────
 *
 * Code, kind, value, and two optional limits. Windows (`starts_at`/`ends_at`),
 * per-person caps and checkout visibility are all real fields and all live on
 * the full editor, which this links to. A wizard step that reproduced every
 * control would be a second copy of that form to keep in step — and the
 * decision being made here is "is there an early-bird price", not "model the
 * whole promotion".
 *
 * ── THE ORGANIZER FUNDS THE DISCOUNT ─────────────────────────────────────
 *
 * Which is why the panel says so. The platform fee is charged on the
 * DISCOUNTED subtotal and the payout shrinks with the discount, automatically.
 * Somebody adding a 40% code to their own event should read that before they
 * add it, not afterwards on a settlement.
 */

const MIN_CODE_LENGTH = 3;

export function CouponsStep({ draft, save }: { draft: Draft; save?: DraftSave }) {
  if (!draft.eventId) {
    return (
      <AccordionCard title="Coupons">
        <NeedsSavedDraft
          title="Add a promo code once the draft exists"
          what="A code is attached to this event, so it needs the event to have been created. That happens automatically as soon as there is a title."
          missing={draft.title.trim() ? [] : ['A title']}
          save={save}
        />
      </AccordionCard>
    );
  }

  return (
    <AccordionCard title="Coupons">
      <CouponManager eventId={draft.eventId} organizationId={draft.organizationId} />
    </AccordionCard>
  );
}

function CouponManager({
  eventId,
  organizationId,
}: {
  eventId: string;
  organizationId: string;
}) {
  const client = useQueryClient();
  const { toast } = useToast();

  // The SAME key `/dashboard/promotions` uses, so a code created here is in
  // that screen's cache the moment it lands rather than after a refetch.
  const key = ['organizer', 'coupons', organizationId];

  const coupons = useQuery({
    queryKey: key,
    queryFn: () => fetchCoupons(organizationId),
    enabled: Boolean(organizationId),
    staleTime: 30_000,
  });

  const invalidate = () => client.invalidateQueries({ queryKey: key });

  const rows = (coupons.data ?? []).filter((coupon) => coupon.event_id === eventId);

  if (!organizationId) {
    return (
      <p className="text-body-sm text-muted-foreground">
        Choose which organisation is running this event first — a code belongs to the organisation
        whose tickets it discounts.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-stack">
      <p className="max-w-prose text-caption text-muted-foreground">
        You fund the discount, so our fee is charged on what the customer actually pays and your
        payout moves with it.{' '}
        <Link href="/dashboard/promotions" className="underline underline-offset-2">
          Full options and organisation-wide codes
        </Link>
        .
      </p>

      {coupons.isPending ? (
        <p className="text-caption text-muted-foreground">Loading your codes…</p>
      ) : coupons.isError ? (
        <p className="text-caption text-muted-foreground" role="alert">
          Could not load your promo codes.
        </p>
      ) : rows.length ? (
        <ul className="flex flex-col gap-2">
          {rows.map((coupon) => (
            <CouponRow
              key={coupon.id}
              coupon={coupon}
              organizationId={organizationId}
              onChanged={invalidate}
            />
          ))}
        </ul>
      ) : (
        <p className="text-caption text-muted-foreground">
          No code for this event yet. Add one below, or leave it — an event sells perfectly well
          without one.
        </p>
      )}

      <AddCoupon
        organizationId={organizationId}
        eventId={eventId}
        existing={rows}
        onAdded={(code) => {
          void invalidate();
          toast({ variant: 'success', title: `${code} is live on this event` });
        }}
      />
    </div>
  );
}

/**
 * One code, and the two things that can be done to it from here.
 *
 * SWITCH OFF rather than delete, wherever there are redemptions: `deleteCoupon`
 * is refused by the server once a code has been used, because a redemption
 * records what it took off and removing the coupon would orphan that history.
 * The control says which one it is doing instead of offering a Delete that
 * sometimes errors.
 */
function CouponRow({
  coupon,
  organizationId,
  onChanged,
}: {
  coupon: Coupon;
  organizationId: string;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const used = coupon.redeemed_count > 0;

  const toggle = useMutation({
    mutationFn: () =>
      updateCoupon(organizationId, coupon.id, { is_active: !coupon.is_active }),
    onSuccess: onChanged,
    onError: (error) => toast({ variant: 'warning', title: errorMessage(error) }),
  });

  const remove = useMutation({
    mutationFn: () => deleteCoupon(organizationId, coupon.id),
    onSuccess: onChanged,
    onError: (error) => toast({ variant: 'warning', title: errorMessage(error) }),
  });

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-stack gap-y-1.5 rounded-lg bg-sunken px-3 py-2">
      <span className="inline-flex min-w-0 items-center gap-2">
        <BadgePercent className="size-3.5 shrink-0 text-primary" aria-hidden />
        <span className="truncate font-mono text-body-sm font-semibold">{coupon.code}</span>
        <span className="shrink-0 text-caption text-muted-foreground">{terms(coupon)}</span>
      </span>

      <span className="flex shrink-0 items-center gap-1.5">
        <span className="text-caption tabular-nums text-muted-foreground">
          {coupon.redeemed_count} used
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => toggle.mutate()}
          disabled={toggle.isPending}
          className="text-muted-foreground"
        >
          {coupon.is_active ? 'Switch off' : 'Switch on'}
        </Button>
        {/* Only for a code nobody has used. A redemption is a record of what
            somebody paid, and the server refuses to remove the coupon it
            points at — so the button is absent rather than offered and then
            refused. */}
        {used ? null : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Delete ${coupon.code}`}
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            className="size-8 text-muted-foreground"
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        )}
      </span>
    </li>
  );
}

function AddCoupon({
  organizationId,
  eventId,
  existing,
  onAdded,
}: {
  organizationId: string;
  eventId: string;
  existing: Coupon[];
  onAdded: (code: string) => void;
}) {
  const [code, setCode] = React.useState('');
  const [kind, setKind] = React.useState<CouponKind>('percent');
  const [value, setValue] = React.useState('');
  const [limit, setLimit] = React.useState('');
  const [failure, setFailure] = React.useState<string | null>(null);

  // UPPER-CASE, because that is how the server stores and compares them. Doing
  // it as they type means the code on screen is the code they will hand out,
  // rather than one that is silently transformed on save.
  const normalised = code.trim().toUpperCase();
  const amount = Number(value);
  const duplicate = existing.some((coupon) => coupon.code === normalised);

  const valid =
    normalised.length >= MIN_CODE_LENGTH &&
    !duplicate &&
    Number.isFinite(amount) &&
    amount > 0 &&
    (kind === 'fixed' || amount <= 100);

  const create = useMutation({
    mutationFn: () =>
      createCoupon(organizationId, {
        code: normalised,
        kind,
        // A percentage is a whole percent; a fixed amount is MINOR UNITS.
        // Money is integer paise everywhere in this codebase, and a rupee
        // figure sent here would discount a hundredth of what was typed.
        value: kind === 'percent' ? Math.round(amount) : Math.round(amount * 100),
        max_redemptions: limit.trim() ? Math.max(1, Math.round(Number(limit))) : null,
        event_id: eventId,
      }),
    onSuccess: () => {
      onAdded(normalised);
      setCode('');
      setValue('');
      setLimit('');
      setFailure(null);
    },
    onError: (error) => setFailure(errorMessage(error)),
  });

  return (
    <div className="flex flex-col gap-stack rounded-xl border border-dashed border-border p-card">
      <div className="grid gap-stack sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="coupon-code">Code</Label>
          <Input
            id="coupon-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="EARLY20"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="font-mono uppercase"
          />
          <p className="text-caption text-muted-foreground">
            {duplicate
              ? 'You already have this code on this event.'
              : `At least ${MIN_CODE_LENGTH} characters. Stored and typed in capitals.`}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="coupon-value">{kind === 'percent' ? 'Percent off' : 'Amount off'}</Label>
          <div className="flex gap-2">
            {/* A two-option switch, not a select: there are exactly two kinds
                and a dropdown for two things is a press to reveal what could
                simply be shown. */}
            <div
              role="group"
              aria-label="Discount type"
              className="flex shrink-0 overflow-hidden rounded-full border border-border"
            >
              {(['percent', 'fixed'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setKind(option)}
                  aria-pressed={kind === option}
                  className={cn(
                    'px-3 text-caption transition-colors duration-fast motion-reduce:transition-none',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    kind === option
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-surface text-muted-foreground hover:bg-muted',
                  )}
                >
                  {option === 'percent' ? '%' : '₹'}
                </button>
              ))}
            </div>
            <Input
              id="coupon-value"
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={kind === 'percent' ? '20' : '150'}
            />
          </div>
          <p className="text-caption text-muted-foreground">
            {kind === 'percent'
              ? 'A whole percent, up to 100.'
              : 'In rupees. A discount never exceeds the order — the server caps it.'}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 sm:max-w-xs">
        <Label htmlFor="coupon-limit">Total redemptions (optional)</Label>
        <Input
          id="coupon-limit"
          inputMode="numeric"
          value={limit}
          onChange={(event) => setLimit(event.target.value)}
          placeholder="Unlimited"
        />
        <p className="text-caption text-muted-foreground">
          The checkout never publishes how many are left — that would turn a promotion into a race.
        </p>
      </div>

      {failure ? (
        // Not red. A failure is reported in words here like everywhere else.
        <p role="alert" className="text-caption text-muted-foreground">
          {failure}
        </p>
      ) : null}

      <Button
        type="button"
        variant="outline"
        onClick={() => create.mutate()}
        disabled={!valid || create.isPending}
        className="w-fit"
      >
        <Plus className="size-4" aria-hidden />
        {create.isPending ? 'Adding…' : 'Add code'}
      </Button>
    </div>
  );
}

/** The terms as the customer would read them, never the stored shape. */
function terms(coupon: Coupon): string {
  if (coupon.kind === 'percent') {
    const cap = coupon.max_discount_minor
      ? `, up to ${formatMoney(coupon.max_discount_minor)}`
      : '';
    return `${coupon.value}% off${cap}`;
  }
  return `${formatMoney(coupon.value)} off`;
}
