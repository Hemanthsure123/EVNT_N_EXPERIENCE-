'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BadgePercent, Download, IndianRupee, RefreshCw, Ticket, TicketPercent, Users } from 'lucide-react';
import type {
  EventAnalytics,
  FeaturePeriod,
  PricePeriod,
  TierAnalytics,
} from '@/lib/api/organizer';
import type { Coupon } from '@/lib/api/coupons';
import { fetchCoupons } from '@/lib/api/coupons';
import { formatMoney } from '@/lib/discovery/format';
import { useActiveOrganization } from '@/lib/organizer/active-organization';
import { downloadCsv, toCsv, type ColumnDef } from '@/lib/organizer/table';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { Skeleton, StatusPill } from '../primitives';
import {
  CARD,
  CARD_PAD,
  EmptyNote,
  Section,
  StatCard,
  TD,
  TH,
  TableCard,
  formatCount,
  formatDateTime,
  formatPct,
  plural,
} from './parts';

/**
 * How the PRICE did: the price timeline, the pricing-feature log, group
 * offers, the tier table and the coupons.
 *
 * ── A PRICE TIMELINE IS PER TIER HERE ────────────────────────────────────
 *
 * The reference has one price per event. Here every tier has its own, so a
 * row names its tier whenever the event has more than one — "₹299" alone
 * would be ambiguous on a page with a General and a VIP.
 *
 * ── THE PAST THE LOG COULD NOT SEE IS SAID, NOT GUESSED ──────────────────
 *
 * A tier's price history is recorded from the moment it was created, or — for
 * a tier edited before recording began — from its next edit. Sales made before
 * that are listed as "before price history began", at what they were BILLED,
 * rather than attributed to a price period nobody recorded.
 *
 * ── REVENUE IN THESE TABLES IS WHAT WAS BILLED ───────────────────────────
 *
 * An early-bird seat counts at its early-bird price. That is why a timeline
 * row's revenue is not always seats x the row's price — the difference is a
 * discount somebody actually got, not a rounding error.
 */

const FEATURE_NAME: Record<FeaturePeriod['feature'], string> = {
  early_bird: 'Early Bird',
  group_offers: 'Group Offers',
};

export function AuditLogsTables({ data, eventId }: { data: EventAnalytics; eventId: string }) {
  const multiTier = new Set(data.tiers.map((tier) => tier.id)).size > 1;
  return (
    <>
      <PriceTimeline data={data} multiTier={multiTier} />
      <FeatureLog periods={data.feature_log} multiTier={multiTier} />
      <GroupOffers data={data} />
      <TierSales tiers={data.tiers} eventTitle={data.event?.title ?? 'event'} />
      <CouponUsage data={data} eventId={eventId} />
    </>
  );
}

/* --------------------------------------------------------- price timeline */

function periodStart(period: PricePeriod): React.ReactNode {
  const prefix =
    period.kind === 'created' ? 'Created • ' : period.kind === 'baseline' ? 'Tracking began • ' : '';
  return (
    <>
      {prefix}
      {formatDateTime(period.started_at)}
    </>
  );
}

function PriceTimeline({ data, multiTier }: { data: EventAnalytics; multiTier: boolean }) {
  const rows = data.price_timeline;
  if (!rows.length && !data.untracked_sales.length) {
    return (
      <Section icon={IndianRupee} title="Price Change Timeline">
        <EmptyNote>This event has no ticket types yet, so there is no price history.</EmptyNote>
      </Section>
    );
  }

  return (
    <Section icon={IndianRupee} title="Price Change Timeline">
      {rows.length ? (
        <TableCard label="Price change timeline">
          <table className="w-full min-w-[36rem]">
            <thead className="bg-sunken">
              <tr>
                <th scope="col" className={TH}>Ticket Price</th>
                <th scope="col" className={TH}>Active Period</th>
                <th scope="col" className={TH}>Spots Sold</th>
                <th scope="col" className={TH}>Revenue</th>
                <th scope="col" className={TH}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((period) => {
                const active = period.status === 'active';
                return (
                  <tr
                    key={`${period.tier_id}-${period.started_at}`}
                    className={cn(active && 'bg-success-subtle/40')}
                  >
                    <td className={cn(TD, 'font-semibold tabular-nums', active && 'text-success')}>
                      {formatMoney(period.price_minor)}
                      {multiTier ? (
                        <span className="block text-caption font-normal text-muted-foreground">
                          {period.tier_name}
                        </span>
                      ) : null}
                    </td>
                    <td className={cn(TD, 'min-w-[12rem] text-muted-foreground', active && 'text-success')}>
                      <span className="block text-foreground">{periodStart(period)}</span>
                      <span className="block">
                        → {period.ended_at ? formatDateTime(period.ended_at) : 'Now'}
                      </span>
                    </td>
                    <td className={cn(TD, 'tabular-nums', active && 'text-success')}>
                      {formatCount(period.seats)}
                    </td>
                    <td className={cn(TD, 'tabular-nums', active && 'text-success')}>
                      {formatMoney(period.revenue_minor)}
                    </td>
                    <td className={TD}>
                      <StatusPill tone={active ? 'success' : 'neutral'}>
                        {active ? 'Active' : 'Ended'}
                      </StatusPill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableCard>
      ) : null}

      {data.untracked_sales.length ? (
        <div className={cn(CARD, CARD_PAD, 'flex flex-col gap-2')}>
          <p className="text-body-sm font-semibold text-foreground">Before price history began</p>
          <ul className="flex flex-col gap-1">
            {data.untracked_sales.map((row) => (
              <li key={row.tier_id} className="text-body-sm text-muted-foreground">
                <span className="text-foreground">{row.tier_name}</span> —{' '}
                {plural(row.seats, 'spot')} for {formatMoney(row.revenue_minor)}
                {row.until ? `, until ${formatDateTime(row.until)}` : ''}
              </li>
            ))}
          </ul>
          <p className="text-caption text-muted-foreground">
            These tiers were edited before price changes were recorded, so the prices on offer then
            are unknown. The figures are what those sales were billed.
          </p>
        </div>
      ) : null}

      {data.history_truncated ? (
        <p className="text-caption text-muted-foreground">
          Showing the most recent price history. Older entries are not listed.
        </p>
      ) : null}
    </Section>
  );
}

/* ------------------------------------------------------------- feature log */

function FeatureLog({ periods, multiTier }: { periods: FeaturePeriod[]; multiTier: boolean }) {
  if (!periods.length) {
    return (
      <Section icon={RefreshCw} title="Pricing Feature Change Log">
        <EmptyNote>
          Early bird and group offers have never been switched on for this event.
        </EmptyNote>
      </Section>
    );
  }

  const total = periods.reduce((sum, period) => sum + period.seats, 0);
  return (
    <Section icon={RefreshCw} title="Pricing Feature Change Log">
      <TableCard label="Pricing feature change log">
        <table className="w-full min-w-[34rem]">
          <thead className="bg-sunken">
            <tr>
              <th scope="col" className={TH}>Feature</th>
              <th scope="col" className={TH}>Status</th>
              <th scope="col" className={TH}>Period</th>
              <th scope="col" className={TH}>Spots Booked</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {periods.map((period) => {
              const enabled = period.status === 'enabled';
              return (
                <tr key={`${period.tier_id}-${period.feature}-${period.enabled_at ?? 'before'}`}>
                  <td className={cn(TD, 'font-medium')}>
                    {FEATURE_NAME[period.feature]}
                    {multiTier ? (
                      <span className="block text-caption font-normal text-muted-foreground">
                        {period.tier_name}
                      </span>
                    ) : null}
                  </td>
                  <td className={TD}>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <StatusPill tone={enabled ? 'success' : 'danger'}>
                        {enabled ? 'Enabled' : 'Disabled'}
                      </StatusPill>
                      {enabled ? <StatusPill tone="info">Current</StatusPill> : null}
                    </span>
                  </td>
                  <td className={cn(TD, 'min-w-[12rem] text-muted-foreground')}>
                    <span className="block text-foreground">
                      {period.enabled_at ? formatDateTime(period.enabled_at) : 'Before history began'}
                    </span>
                    <span className="block">
                      → {period.disabled_at ? formatDateTime(period.disabled_at) : 'Present'}
                    </span>
                  </td>
                  <td className={cn(TD, 'tabular-nums')}>{formatCount(period.seats)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 border-primary/40 bg-sunken">
            <tr>
              <th scope="row" colSpan={3} className={cn(TH, 'text-body-sm font-semibold text-primary')}>
                Total Spots Booked
              </th>
              <td className={cn(TD, 'font-semibold tabular-nums text-primary')}>{formatCount(total)}</td>
            </tr>
          </tfoot>
        </table>
      </TableCard>
      <p className="text-caption text-muted-foreground">
        Spots are the seats each feature actually priced while it was on.
      </p>
    </Section>
  );
}

/* ------------------------------------------------------------ group offers */

function GroupOffers({ data }: { data: EventAnalytics }) {
  const offers = data.group_offers;
  const used = offers.orders > 0;
  const pill = (
    <StatusPill tone={offers.enabled ? 'success' : 'neutral'}>
      {offers.enabled ? 'Enabled' : 'Off'}
    </StatusPill>
  );

  // Never on and never used: a row of zeros would read as "it didn't work",
  // when the truth is that nobody offered it.
  if (!offers.enabled && !used) {
    return (
      <Section icon={Users} title="Group Offers" trailing={pill}>
        <EmptyNote>No tier on this event offers a group price.</EmptyNote>
      </Section>
    );
  }

  return (
    <Section icon={Users} title="Group Offers" trailing={pill}>
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <StatCard icon={Users} label="Orders" value={formatCount(offers.orders)} />
        <StatCard icon={Users} label="Spots Booked" value={formatCount(offers.seats)} />
        <StatCard
          icon={IndianRupee}
          label="Revenue"
          value={formatMoney(offers.revenue_minor)}
          caption={
            offers.bands.length
              ? offers.bands
                  .map((band) => `${band.min_quantity}+ tickets (${formatMoney(band.revenue_minor)})`)
                  .join(', ')
              : undefined
          }
        />
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------- tier table */

function TierSales({ tiers, eventTitle }: { tiers: TierAnalytics[]; eventTitle: string }) {
  return (
    <Section
      icon={Ticket}
      title="Tier Sales"
      trailing={
        tiers.length ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => exportTiers(tiers, eventTitle)}
            className="shrink-0 text-muted-foreground"
          >
            <Download className="size-3.5" aria-hidden />
            CSV
          </Button>
        ) : null
      }
    >
      {tiers.length ? (
        <TableCard label="Tier sales">
          <table className="w-full min-w-[32rem]">
            <thead className="bg-sunken">
              <tr>
                <th scope="col" className={TH}>Tier</th>
                <th scope="col" className={TH}>Price</th>
                <th scope="col" className={TH}>Per Person</th>
                <th scope="col" className={TH}>Orders</th>
                <th scope="col" className={TH}>Spots</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tiers.map((tier) => (
                <tr key={tier.id} className={cn(tier.is_past && 'bg-sunken/60')}>
                  <td className={cn(TD, 'min-w-[9rem]')}>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{tier.name}</span>
                      {tier.is_past ? <StatusPill tone="warning">Past Tier</StatusPill> : null}
                    </span>
                  </td>
                  <td className={cn(TD, 'tabular-nums')}>{formatMoney(tier.price_minor)}</td>
                  <td className={cn(TD, 'tabular-nums text-muted-foreground')}>
                    {formatMoney(tier.per_person_minor)}
                  </td>
                  <td className={cn(TD, 'tabular-nums')}>{formatCount(tier.orders)}</td>
                  <td className={cn(TD, 'tabular-nums')}>{formatCount(tier.seats)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      ) : (
        <EmptyNote>This event has no ticket types, so there is nothing to sell yet.</EmptyNote>
      )}
      {tiers.some((tier) => tier.reserved > 0) ? (
        <p className="text-caption text-muted-foreground">
          {plural(
            tiers.reduce((sum, tier) => sum + tier.reserved, 0),
            'ticket',
          )}{' '}
          held in carts right now, not counted above.
        </p>
      ) : null}
    </Section>
  );
}

/**
 * MAJOR UNITS in the export, unlike everywhere else: a CSV is opened by a
 * human and summed by a formula, and paise there would make every total built
 * on it wrong by a factor of 100, silently.
 */
const TIER_EXPORT_COLUMNS: ColumnDef<TierAnalytics>[] = [
  { key: 'name', header: 'Tier', width: 200, render: (tier) => tier.name },
  {
    key: 'price',
    header: 'Price',
    width: 120,
    numeric: true,
    render: (tier) => tier.price_minor,
    exportValue: (tier) => (tier.price_minor / 100).toFixed(2),
  },
  {
    key: 'per_person',
    header: 'Per person (billed)',
    width: 140,
    numeric: true,
    render: (tier) => tier.per_person_minor ?? '',
    exportValue: (tier) =>
      tier.per_person_minor === null ? '' : (tier.per_person_minor / 100).toFixed(2),
  },
  { key: 'orders', header: 'Orders', width: 100, numeric: true, render: (tier) => tier.orders, exportValue: (tier) => tier.orders },
  { key: 'seats', header: 'Spots', width: 100, numeric: true, render: (tier) => tier.seats, exportValue: (tier) => tier.seats },
  { key: 'quantity', header: 'Quantity', width: 100, numeric: true, render: (tier) => tier.quantity, exportValue: (tier) => tier.quantity },
  {
    key: 'charged',
    header: 'Billed',
    width: 140,
    numeric: true,
    render: (tier) => tier.charged_minor,
    exportValue: (tier) => (tier.charged_minor / 100).toFixed(2),
  },
  {
    key: 'past',
    header: 'Past tier',
    width: 100,
    render: (tier) => (tier.is_past ? 'yes' : ''),
    exportValue: (tier) => (tier.is_past ? 'yes' : ''),
  },
];

function exportTiers(tiers: TierAnalytics[], eventTitle: string) {
  const slug = eventTitle.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'event';
  downloadCsv(`${slug}-tiers.csv`, toCsv(TIER_EXPORT_COLUMNS, tiers));
}

/* ------------------------------------------------------------------ coupons */

/**
 * WHAT THE DISCOUNTS COST, then WHICH CODES they were.
 *
 * The two cards are this event's own bookings. The code list is every code
 * that works at this checkout — and an organization-wide code's redemption
 * count is its total across every event, which is why that group says so: a
 * per-event split of it needs a read that does not exist, and showing the
 * total under this event's heading would attribute another event's discounts
 * to this one.
 */
function CouponUsage({ data, eventId }: { data: EventAnalytics; eventId: string }) {
  const coupons = data.coupons;
  return (
    <Section icon={TicketPercent} title="Coupon Usage Statistics">
      {/* `relative` so anything absolutely positioned inside stays inside —
          see the same scroller in `audience-and-feedback.tsx` for the 552px
          page that taught this. */}
      <div className="relative -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 touch-manipulation [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
        <StatCard
          icon={TicketPercent}
          label="Coupons Used"
          value={formatCount(coupons.orders)}
          caption={`${formatPct(coupons.pct_of_orders)} of bookings`}
          className="w-[75%] shrink-0 snap-start sm:w-auto"
        />
        <StatCard
          icon={IndianRupee}
          label="Total Discount"
          value={formatMoney(coupons.discount_minor)}
          caption="Revenue discounted"
          className="w-[75%] shrink-0 snap-start sm:w-auto"
        />
      </div>
      <CouponCodes eventId={eventId} />
    </Section>
  );
}

function CouponCodes({ eventId }: { eventId: string }) {
  const { organization, ready } = useActiveOrganization();
  // The SAME key the promotions screen uses — one cache entry, not two.
  const query = useQuery({
    queryKey: ['organizer', 'coupons', organization?.id],
    queryFn: () => fetchCoupons(organization!.id),
    enabled: Boolean(organization?.id),
    staleTime: 30_000,
  });

  if (!ready || (organization && query.isPending)) return <Skeleton className="h-16 w-full rounded-2xl" />;
  if (!organization || query.isError) return null;

  const all = query.data ?? [];
  const scoped = all.filter((coupon) => coupon.event_id === eventId);
  const wide = all.filter((coupon) => coupon.event_id === null);
  if (!scoped.length && !wide.length) {
    return (
      <p className="text-caption text-muted-foreground">
        No promo code applies to this event.{' '}
        <Link href="/dashboard/promotions" className="underline underline-offset-2">
          Create one
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {scoped.length ? <CodeGroup coupons={scoped} caption="Codes for this event" /> : null}
      {wide.length ? (
        <CodeGroup
          coupons={wide}
          caption="Codes that work on every event you run"
          note="Redemptions below are each code’s total across all your events, not this event’s share."
        />
      ) : null}
    </div>
  );
}

function CodeGroup({ coupons, caption, note }: { coupons: Coupon[]; caption: string; note?: string }) {
  return (
    <div className={cn(CARD, CARD_PAD, 'flex flex-col gap-3')}>
      <div className="flex flex-col gap-0.5">
        <h3 className="text-body-sm font-semibold text-foreground">{caption}</h3>
        {note ? <p className="text-caption text-muted-foreground">{note}</p> : null}
      </div>
      <ul className="flex flex-col gap-2">
        {coupons.map((coupon) => (
          <li
            key={coupon.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg bg-sunken px-3 py-2"
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <BadgePercent className="size-3.5 shrink-0 text-primary" aria-hidden />
              <span className="truncate font-mono text-body-sm font-semibold">{coupon.code}</span>
              <span className="shrink-0 text-caption text-muted-foreground">{couponTerms(coupon)}</span>
              {coupon.is_active ? null : (
                <span className="shrink-0 text-caption text-muted-foreground">· switched off</span>
              )}
            </span>
            <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
              {coupon.redeemed_count} used
              {coupon.max_redemptions === null ? '' : ` of ${coupon.max_redemptions}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function couponTerms(coupon: Coupon): string {
  if (coupon.kind === 'percent') {
    const cap = coupon.max_discount_minor ? `, up to ${formatMoney(coupon.max_discount_minor)}` : '';
    return `${coupon.value}% off${cap}`;
  }
  return `${formatMoney(coupon.value)} off`;
}
