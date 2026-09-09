'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgePercent, Pencil, Plus, Tag } from 'lucide-react';
import {
  createCoupon,
  deleteCoupon,
  fetchCoupons,
  updateCoupon,
  type Coupon,
  type CouponInput,
  type CouponKind,
} from '@/lib/api/coupons';
import { errorMessage } from '@/lib/api/errors';
import { useActiveOrganization } from '@/lib/organizer/active-organization';
import { useEventRows } from '@/lib/organizer/queries';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Panel, Skeleton, StatusPill } from '@/components/organizer/primitives';
import { cn } from '@/lib/utils/cn';
import { couponStatus, describeTerms, describeUsage, validateDraft } from '@/lib/organizer/coupons';

/**
 * Promotional codes — the organizer's own discounts on their own events.
 *
 * ── WHY THIS SECTION EXISTS AT ALL ───────────────────────────────────────
 *
 * `lib/organizer/nav.ts` listed Coupons and Promotions among the sections the
 * brief asked for and this dashboard deliberately did NOT build, "because a nav
 * item that 404s — or that leads to a permanently empty screen — teaches an
 * organizer to distrust the whole dashboard". That reasoning is unchanged; what
 * changed is that `apps/coupons` exists, so the section is backed.
 *
 * ── A TABLE, BECAUSE A CODE IS DATA ──────────────────────────────────────
 *
 * The crew roster next door is cards, because a roster is a set of PEOPLE and
 * the photograph is the field somebody recognises them by. A promotions list is
 * scanned on four columns — what it takes off, how much of it is gone, when it
 * stops, and whether it is live — so it is a table, and the numbers are
 * `tabular-nums` so a column of them can be compared by eye.
 *
 * It is NOT the dashboard's cursor-paginated table engine. That machinery
 * exists for server-paginated lists with filter state in the URL; this is one
 * bounded request for at most `MAX_COUPONS_PER_ORGANIZATION` rows, and wiring
 * it through a paginator would promise sorting and filtering that nothing
 * behind it can do.
 *
 * ── USAGE IS A REAL COUNT, AND "UNLIMITED" IS NOT A NUMBER ───────────────
 *
 * `redeemed_count` comes from ONE aggregate over the page. A coupon with no
 * `max_redemptions` shows "12 used" rather than "12 of ∞" — a denominator that
 * does not exist is not a denominator, and inventing one is how a progress bar
 * ends up describing nothing.
 */
export function Promotions() {
  // The ACTIVE organisation, never `organizations[0]`. A code written against a
  // guess is a discount defined on the wrong brand's tickets, with every
  // request succeeding.
  const { organization, organizations, ready, needsChoice, hasNone, choose } =
    useActiveOrganization();
  const [editing, setEditing] = React.useState<Coupon | null>(null);
  const [adding, setAdding] = React.useState(false);

  const coupons = useQuery({
    queryKey: ['organizer', 'coupons', organization?.id],
    queryFn: () => fetchCoupons(organization!.id),
    enabled: Boolean(organization?.id),
    staleTime: 30_000,
  });

  if (!ready) return <Skeleton className="h-64 w-full" />;

  if (hasNone) {
    return (
      <Panel title="Promotions">
        <p className="text-body-sm text-muted-foreground">
          Create an organisation first — a promo code belongs to the organisation whose
          tickets it discounts, so it can be reused across every event you run.
        </p>
      </Panel>
    );
  }

  if (needsChoice || !organization) {
    return (
      <Panel title="Promotions">
        <p className="text-body-sm text-muted-foreground">
          You run more than one organisation. Choose whose codes you are managing — this also
          sets the organisation for the rest of the dashboard.
        </p>
        <ul className="mt-stack flex flex-col gap-2">
          {organizations.map((candidate) => (
            <li key={candidate.id}>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => choose(candidate)}
              >
                {candidate.name}
              </Button>
            </li>
          ))}
        </ul>
      </Panel>
    );
  }

  const rows = coupons.data ?? [];

  return (
    <div className="flex flex-col gap-block">
      <header className="flex flex-col gap-stack sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-h3 md:text-h2">Promotions</h1>
          <p className="max-w-prose text-body text-muted-foreground">
            Discount codes for your own events. You fund the discount, so our fee is charged on
            what the customer actually pays and your payout moves with it.
          </p>
        </div>
        <Button onClick={() => setAdding(true)} className="shrink-0 gap-1.5">
          <Plus className="size-4" aria-hidden />
          New code
        </Button>
      </header>

      {coupons.isPending ? (
        <Skeleton className="h-56 w-full" />
      ) : rows.length === 0 ? (
        <EmptyPromotions onAdd={() => setAdding(true)} />
      ) : (
        <CouponTable rows={rows} onEdit={setEditing} />
      )}

      <CouponSheet
        organizationId={organization.id}
        coupon={editing}
        open={adding || editing !== null}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

function EmptyPromotions({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center gap-stack-lg rounded-2xl border border-dashed border-border px-6 py-14 text-center">
      <span
        aria-hidden
        className="inline-flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <Tag className="size-6" />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-body font-medium text-foreground">No codes yet</p>
        <p className="text-body-sm text-muted-foreground">
          Make one for an influencer, a partner or an early-bird push. A code is private by
          default — only somebody who has it can use it, which is usually the point.
        </p>
      </div>
      <Button onClick={onAdd} className="gap-1.5">
        <Plus className="size-4" aria-hidden />
        New code
      </Button>
    </div>
  );
}

function CouponTable({ rows, onEdit }: { rows: Coupon[]; onEdit: (coupon: Coupon) => void }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <Th>Code</Th>
              <Th>Discount</Th>
              <Th numeric>Used</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Edit</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((coupon) => {
              const status = couponStatus(coupon, new Date());
              return (
                <tr key={coupon.id} className="border-b border-border last:border-b-0">
                  <td className="px-card py-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        aria-hidden
                        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                      >
                        <BadgePercent className="size-4" />
                      </span>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-mono text-body-sm font-semibold tracking-wide text-foreground">
                          {coupon.code}
                        </span>
                        {/* The two facts about a code that are not its terms
                            and are not its state: who can see it, and what it
                            applies to. Both are absent when they are the
                            default, so a row only says what is unusual. */}
                        <span className="truncate text-caption text-muted-foreground">
                          {[
                            coupon.visible_at_checkout ? 'Shown at checkout' : null,
                            coupon.event_id ? 'One event' : null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || 'Private code'}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-card py-3 text-body-sm text-foreground">
                    {describeTerms(coupon)}
                  </td>
                  <td className="px-card py-3 text-right text-body-sm tabular-nums text-foreground">
                    {describeUsage(coupon)}
                  </td>
                  <td className="px-card py-3">
                    <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  </td>
                  <td className="px-card py-3 text-right">
                    <button
                      type="button"
                      onClick={() => onEdit(coupon)}
                      aria-label={`Edit ${coupon.code}`}
                      className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Pencil className="size-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, numeric = false }: { children: React.ReactNode; numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        'px-card py-2.5 text-caption font-medium uppercase tracking-wide text-muted-foreground',
        numeric && 'text-right',
      )}
    >
      {children}
    </th>
  );
}

/**
 * Create or edit one code.
 *
 * ── THE CODE IS ONLY EDITABLE WHILE UNUSED, AND THE FORM SAYS SO ─────────
 *
 * The server refuses to rename a redeemed coupon — the code is the thing people
 * were given, and changing it breaks every printed copy while the history keeps
 * pointing at something nobody can now type. Rather than surfacing that as an
 * error after a save, the field is disabled with the reason beside it.
 *
 * ── AND THERE IS NO DELETE ONCE IT HAS BEEN USED ─────────────────────────
 *
 * Same rule, same reason: a redemption is a financial record. The control
 * offered instead is "switch off", which stops the code working and leaves
 * every booking that used it holding its reason for costing less.
 */
function CouponSheet({
  organizationId,
  coupon,
  open,
  onClose,
}: {
  organizationId: string;
  coupon: Coupon | null;
  open: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [code, setCode] = React.useState('');
  const [kind, setKind] = React.useState<CouponKind>('percent');
  const [value, setValue] = React.useState('');
  const [cap, setCap] = React.useState('');
  const [endsAt, setEndsAt] = React.useState('');
  const [maxRedemptions, setMaxRedemptions] = React.useState('');
  const [maxPerUser, setMaxPerUser] = React.useState('1');
  const [visible, setVisible] = React.useState(false);
  const [eventId, setEventId] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const eventsQuery = useEventRows({});
  const events = React.useMemo(
    () => eventsQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [eventsQuery.data],
  );

  React.useEffect(() => {
    if (!open) return;
    setCode(coupon?.code ?? '');
    setKind(coupon?.kind ?? 'percent');
    // Rupees in the box, paise on the wire — the same split the donation card
    // makes, and the only place in this codebase a person types a major unit.
    setValue(
      coupon ? String(coupon.kind === 'percent' ? coupon.value : coupon.value / 100) : '',
    );
    setCap(coupon?.max_discount_minor ? String(coupon.max_discount_minor / 100) : '');
    setEndsAt(coupon?.ends_at ? coupon.ends_at.slice(0, 10) : '');
    setMaxRedemptions(coupon?.max_redemptions ? String(coupon.max_redemptions) : '');
    setMaxPerUser(String(coupon?.max_per_user ?? 1));
    setVisible(coupon?.visible_at_checkout ?? false);
    setEventId(coupon?.event_id ?? '');
    setError(null);
  }, [open, coupon]);

  const invalidate = () =>
    client.invalidateQueries({ queryKey: ['organizer', 'coupons', organizationId] });

  const draft = {
    code,
    kind,
    value,
    cap,
    endsAt,
    maxRedemptions,
    maxPerUser,
    visible,
    eventId,
  };
  const issues = validateDraft(draft);

  const save = useMutation({
    mutationFn: () => {
      const input = toInput(draft);
      return coupon
        ? // The CODE is left out of an edit when it has not changed. Sending it
          // unchanged is harmless, but sending it on a redeemed coupon is what
          // the server refuses — and an organizer who only touched the end date
          // should not meet that refusal.
          updateCoupon(organizationId, coupon.id, {
            ...input,
            ...(input.code === coupon.code ? { code: undefined } : {}),
          })
        : createCoupon(organizationId, input);
    },
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
    // The server's sentence names the specific problem — a cap on a fixed
    // amount, a window that ends before it starts, a code already taken — so it
    // is shown verbatim rather than replaced with something generic.
    onError: (thrown) => setError(errorMessage(thrown)),
  });

  const toggleActive = useMutation({
    mutationFn: () =>
      coupon
        ? updateCoupon(organizationId, coupon.id, { is_active: !coupon.is_active })
        : Promise.reject(new Error('No coupon')),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
    onError: (thrown) => setError(errorMessage(thrown)),
  });

  const remove = useMutation({
    mutationFn: () => (coupon ? deleteCoupon(organizationId, coupon.id) : Promise.resolve()),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
    onError: (thrown) => setError(errorMessage(thrown)),
  });

  const used = (coupon?.redeemed_count ?? 0) > 0;
  const busy = save.isPending || toggleActive.isPending || remove.isPending;

  return (
    <Drawer open={open} onOpenChange={(next) => !next && onClose()}>
      <DrawerContent side="responsive" aria-label={coupon ? 'Edit code' : 'New code'}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!issues.length) save.mutate();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <header className="flex shrink-0 flex-col gap-stack border-b border-border px-6 pb-card pt-card-lg">
            <DrawerTitle>{coupon ? 'Edit code' : 'New code'}</DrawerTitle>
            <DrawerDescription>
              You fund the discount. Our fee is charged on what the customer pays after it, and
              your payout is the discounted ticket revenue.
            </DrawerDescription>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-block overflow-y-auto px-6 py-card-lg">
            <div className="flex flex-col gap-2">
              <Label htmlFor="coupon-code">Code</Label>
              <Input
                id="coupon-code"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="SUMMER20"
                autoComplete="off"
                spellCheck={false}
                required
                autoFocus={!coupon}
                disabled={used}
                className="font-mono tracking-wide"
              />
              <p className="text-caption text-muted-foreground">
                {used
                  ? 'This code has been used, so it can’t be renamed — people already have it. Switch it off and make a new one instead.'
                  : 'Letters, numbers, dashes and underscores. People retype it off a poster, so shorter is kinder.'}
              </p>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-label text-foreground">Discount</legend>
              <div className="flex gap-2">
                <KindChip selected={kind === 'percent'} onClick={() => setKind('percent')}>
                  Percentage
                </KindChip>
                <KindChip selected={kind === 'fixed'} onClick={() => setKind('fixed')}>
                  Fixed amount
                </KindChip>
              </div>
              <div className="mt-2 grid gap-stack sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="coupon-value">
                    {kind === 'percent' ? 'Percent off' : 'Amount off'}
                  </Label>
                  <Input
                    id="coupon-value"
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    inputMode="decimal"
                    placeholder={kind === 'percent' ? '20' : '100'}
                    required
                  />
                </div>
                {/* The ceiling only exists for a percentage — on a fixed amount
                    it IS the fixed amount, and the server refuses one rather
                    than ignoring it. So the field is absent, not disabled. */}
                {kind === 'percent' ? (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="coupon-cap">Most it can take off (optional)</Label>
                    <Input
                      id="coupon-cap"
                      value={cap}
                      onChange={(event) => setCap(event.target.value)}
                      inputMode="decimal"
                      placeholder="500"
                    />
                    <p className="text-caption text-muted-foreground">
                      20% is ₹40 on a ₹200 ticket and ₹4,000 on a ₹20,000 table. This is where
                      you say which one you meant.
                    </p>
                  </div>
                ) : null}
              </div>
            </fieldset>

            <div className="grid gap-stack sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="coupon-ends">Stops working on (optional)</Label>
                <Input
                  id="coupon-ends"
                  type="date"
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="coupon-max">Total uses (optional)</Label>
                <Input
                  id="coupon-max"
                  value={maxRedemptions}
                  onChange={(event) => setMaxRedemptions(event.target.value)}
                  inputMode="numeric"
                  placeholder="Unlimited"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="coupon-per-user">Uses per person</Label>
                <Input
                  id="coupon-per-user"
                  value={maxPerUser}
                  onChange={(event) => setMaxPerUser(event.target.value)}
                  inputMode="numeric"
                  placeholder="1"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="coupon-event">Applies to</Label>
                <select
                  id="coupon-event"
                  value={eventId}
                  onChange={(event) => setEventId(event.target.value)}
                  className="h-11 w-full rounded-md border border-input bg-surface px-3 text-body text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Every event you run</option>
                  {events.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface p-card">
              <input
                type="checkbox"
                checked={visible}
                onChange={(event) => setVisible(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[hsl(var(--primary))]"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-body-sm font-medium text-foreground">
                  Show this code on the checkout
                </span>
                <span className="text-caption text-muted-foreground">
                  Off by default. A code given to one partner stops being worth anything the
                  moment everybody can see it — turn this on only for a public offer.
                </span>
              </span>
            </label>

            {issues.length ? (
              <ul className="flex flex-col gap-1">
                {issues.map((issue) => (
                  <li key={issue} className="text-caption text-muted-foreground">
                    {issue}
                  </li>
                ))}
              </ul>
            ) : null}
            {error ? (
              <p role="alert" className="text-caption text-muted-foreground">
                {error}
              </p>
            ) : null}
          </div>

          <footer className="flex shrink-0 flex-col gap-2 border-t border-border px-6 py-card sm:flex-row sm:items-center sm:justify-between">
            {coupon ? (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => toggleActive.mutate()}
                >
                  {coupon.is_active ? 'Switch off' : 'Switch on'}
                </Button>
                {/* Absent once it has been redeemed, rather than present and
                    refused. A control whose job is to fail is worse than no
                    control — the same rule the wizard's Review step follows. */}
                {used ? null : (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => remove.mutate()}
                  >
                    Delete
                  </Button>
                )}
              </div>
            ) : (
              <span />
            )}
            <div className="flex gap-2 sm:justify-end">
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || issues.length > 0}>
                {coupon ? 'Save' : 'Create code'}
              </Button>
            </div>
          </footer>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

function KindChip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'h-control rounded-full border px-pill text-label transition duration-fast ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'border-transparent bg-cta text-cta-foreground'
          : 'border-border bg-surface text-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

/** Rupees in the form, paise on the wire. One conversion, in one place. */
function toInput(draft: {
  code: string;
  kind: CouponKind;
  value: string;
  cap: string;
  endsAt: string;
  maxRedemptions: string;
  maxPerUser: string;
  visible: boolean;
  eventId: string;
}): CouponInput {
  const major = Number(draft.value.replace(/[^\d.]/g, ''));
  return {
    code: draft.code.trim().toUpperCase(),
    kind: draft.kind,
    value: draft.kind === 'percent' ? Math.round(major) : Math.round(major * 100),
    max_discount_minor:
      draft.kind === 'percent' && draft.cap.trim()
        ? Math.round(Number(draft.cap.replace(/[^\d.]/g, '')) * 100)
        : null,
    // A date with no time is the START of that day in the browser's zone, which
    // would stop a code working a day early for an organizer who typed the last
    // date they wanted it live. End of day is what "stops working on the 30th"
    // means to the person typing it.
    ends_at: draft.endsAt ? new Date(`${draft.endsAt}T23:59:59`).toISOString() : null,
    max_redemptions: draft.maxRedemptions.trim() ? Number(draft.maxRedemptions) : null,
    max_per_user: Number(draft.maxPerUser) || 1,
    visible_at_checkout: draft.visible,
    event_id: draft.eventId || null,
  };
}
