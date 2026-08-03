'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Database,
  HardDrive,
  Mail,
  MessageSquare,
  Radio,
  RefreshCw,
  Server,
  Wallet,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { fetchHealth, type HealthCheck, type HealthStatus } from '@/lib/api/admin';
import { errorMessage } from '@/lib/api/errors';
import { ErrorState, Skeleton, StatusPill, type Tone } from '@/components/organizer/primitives';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

/**
 * The operations centre.
 *
 * ── THE ONE RULE THIS SCREEN EXISTS TO KEEP ───────────────────────────────
 *
 * **A tile is never green because nobody looked.** The backend reports two
 * genuinely different things and this screen renders them differently:
 *
 * - **Probed** — the database and the cache are actually touched on every
 *   request (a connection, a cache round-trip). `ok` here is evidence.
 * - **Configured** — payments, storage, queue, event bus, email and SMS report
 *   WHICH adapter is selected and whether it is a real vendor or a local fake.
 *   They come back `unknown`, and `unknown` is drawn as its own state with its
 *   own icon and the sentence "not contacted" — not as a pale green.
 *
 * Probing a payment provider on every dashboard poll would put real traffic on
 * a third party to decorate a widget. The honest answer is to say what is
 * known and what is not, which is what an operator deciding whether to page
 * somebody actually needs.
 *
 * ── A LOCAL ADAPTER IS CALLED OUT ─────────────────────────────────────────
 *
 * "console adapter (local/fake)" on an email tile in production means no
 * customer is receiving anything. That is the most important thing this screen
 * can tell an operator, and it is one string from the server rather than an
 * inference.
 *
 * ── WHAT IS ABSENT, AND WHY IT WOULD BE WORSE TO INVENT ───────────────────
 *
 * Latency, error rates, response times, health history, background-job depth,
 * logs and traces. **Nothing measures any of them.** There is no metrics
 * store, no request-timing middleware in production (the perf logger is
 * DEBUG-only), and the queue adapter is synchronous in dev so "jobs pending"
 * is structurally always zero. A latency chart here would be a drawing.
 * BACKLOG item 50 specifies the collector, the store and the retention this
 * needs.
 *
 * ── HOW THE STATES ARE DRAWN ──────────────────────────────────────────────
 *
 * A tile is a plain hairline card carrying its state as a pill at the top
 * right, so eight tiles read as one column of statuses rather than eight
 * paragraphs. Colour is reserved for the exception: a HEALTHY tile gets the
 * ordinary `border-border` (a green edge on the seven things that are fine is
 * decoration), DEGRADED gets a full-strength `border-destructive` plus the
 * tint AND a solid pill — the subtle pill would disappear into its own tinted
 * card — and NOT CONTACTED keeps its dashed edge, its own icon and its own
 * words. Nothing here is green because nobody looked.
 */

const REFRESH_MS = 30_000;

const ICONS: Record<string, LucideIcon> = {
  database: Database,
  cache: Zap,
  payments: Wallet,
  storage: HardDrive,
  queue: Server,
  event_bus: Radio,
  email: Mail,
  sms: MessageSquare,
};

const LABELS: Record<string, string> = {
  database: 'Database',
  cache: 'Cache',
  payments: 'Payments',
  storage: 'Storage',
  queue: 'Task queue',
  event_bus: 'Event bus',
  email: 'Email',
  sms: 'SMS',
};

/** Which checks the backend actually contacts. Everything else is configured. */
const PROBED = new Set(['database', 'cache']);

export function HealthCentre() {
  const query = useQuery({
    queryKey: ['admin', 'health'],
    queryFn: fetchHealth,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
  });

  const checks = query.data?.checks ?? [];
  const probed = checks.filter((check) => PROBED.has(check.name));
  const configured = checks.filter((check) => !PROBED.has(check.name));
  const degraded = checks.filter((check) => check.status === 'degraded');
  const fakes = configured.filter((check) => check.detail.includes('local/fake'));

  return (
    <div className="flex flex-col gap-block-lg">
      <header className="flex flex-wrap items-end justify-between gap-stack-lg">
        <div className="min-w-0">
          <h1 className="text-h3">System health</h1>
          <p className="max-w-prose text-body-sm text-muted-foreground">
            Refreshed every 30 seconds. Probed checks are contacted on each request; configured
            ones report which adapter is wired up.
          </p>
        </div>
        {/* The one control on a read-only screen, and auto-refresh already
            covers the common case — so it is a quiet outline button, not the
            near-black pill. Nothing here should out-rank the tiles. */}
        <Button
          type="button"
          variant="outline"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          leftIcon={
            <RefreshCw className={cn('size-4', query.isFetching && 'animate-spin')} aria-hidden />
          }
        >
          Refresh
        </Button>
      </header>

      {query.isError ? (
        <ErrorState
          message={errorMessage(query.error)}
          onRetry={() => void query.refetch()}
          className="rounded-xl border border-border bg-surface"
        />
      ) : query.isPending ? (
        <div className="grid gap-stack sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <Banner degraded={degraded} fakes={fakes} />

          <section className="flex flex-col gap-stack">
            <SectionHead
              title="Probed"
              blurb="Contacted on every request. A green tile here is evidence, not an assumption."
            />
            <ul className="grid gap-stack sm:grid-cols-2">
              {probed.map((check) => (
                <li key={check.name}>
                  <HealthTile check={check} probed />
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-stack">
            <SectionHead
              title="Configured"
              blurb="Which adapter is selected. NOT contacted — probing a vendor on every poll would put real traffic on them to colour a tile."
            />
            <ul className="grid gap-stack sm:grid-cols-2 xl:grid-cols-3">
              {configured.map((check) => (
                <li key={check.name}>
                  <HealthTile check={check} probed={false} />
                </li>
              ))}
            </ul>
          </section>

          <NotMeasured />
        </>
      )}
    </div>
  );
}

function SectionHead({ title, blurb }: { title: string; blurb: string }) {
  return (
    <header>
      <h2 className="text-body font-semibold text-foreground">{title}</h2>
      <p className="max-w-prose text-caption text-muted-foreground">{blurb}</p>
    </header>
  );
}

function Banner({ degraded, fakes }: { degraded: HealthCheck[]; fakes: HealthCheck[] }) {
  if (degraded.length) {
    return (
      <div
        role="alert"
        className="flex items-start gap-stack rounded-xl border border-destructive bg-destructive-subtle p-card"
      >
        <AlertTriangle
          className="mt-0.5 size-4 shrink-0 text-destructive-subtle-foreground"
          aria-hidden
        />
        <div className="min-w-0">
          <p className="text-body-sm font-medium text-destructive-subtle-foreground">
            {degraded.length} dependenc{degraded.length === 1 ? 'y is' : 'ies are'} degraded
          </p>
          <p className="text-caption text-destructive-subtle-foreground">
            {degraded.map((check) => LABELS[check.name] ?? check.name).join(', ')} failed a live
            probe just now. The platform is affected.
          </p>
        </div>
      </div>
    );
  }

  if (fakes.length) {
    return (
      <div className="flex items-start gap-stack rounded-xl border border-warning-subtle bg-warning-subtle p-card">
        <AlertTriangle
          className="mt-0.5 size-4 shrink-0 text-warning-subtle-foreground"
          aria-hidden
        />
        <div className="min-w-0">
          <p className="text-body-sm font-medium text-warning-subtle-foreground">
            {fakes.length} dependenc{fakes.length === 1 ? 'y is' : 'ies are'} running a local
            adapter
          </p>
          {/* The single most important thing this screen can say. An email
              tile on a fake adapter in production means no customer is
              receiving anything, and it would otherwise look fine. */}
          <p className="text-caption text-warning-subtle-foreground">
            {fakes.map((check) => LABELS[check.name] ?? check.name).join(', ')} are not wired to a
            real vendor. Expected in development; in production it means nothing is actually being
            sent or charged.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-stack rounded-xl border border-border bg-surface p-card">
      <span
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-success-subtle"
        aria-hidden
      >
        <CheckCircle2 className="size-4 text-success-subtle-foreground" />
      </span>
      <div className="min-w-0">
        <p className="text-body-sm font-medium text-foreground">Everything probed is healthy</p>
        <p className="text-caption text-muted-foreground">
          The database and cache both answered. Vendor adapters below report their configuration
          only.
        </p>
      </div>
    </div>
  );
}

const TONE: Record<
  HealthStatus,
  { wrap: string; pill: Tone; pillClass?: string; icon: LucideIcon; word: string }
> = {
  // The ordinary hairline. Seven healthy tiles edged in green is decoration,
  // and it spends the colour budget on the six things that are fine.
  ok: { wrap: 'border-border', pill: 'success', icon: CheckCircle2, word: 'Healthy' },
  degraded: {
    wrap: 'border-destructive bg-destructive-subtle',
    pill: 'danger',
    // The card is already tinted, so the subtle pill would vanish into it. A
    // solid fill keeps the one broken tile findable in a grid of eight.
    pillClass: 'bg-destructive text-destructive-foreground',
    icon: AlertTriangle,
    word: 'Degraded',
  },
  // Its own visual state, deliberately. A pale green here is the tile an
  // operator would trust to page somebody.
  unknown: {
    wrap: 'border-dashed border-border',
    pill: 'neutral',
    icon: CircleHelp,
    word: 'Not contacted',
  },
};

function HealthTile({ check, probed }: { check: HealthCheck; probed: boolean }) {
  const tone = TONE[check.status];
  const Icon = ICONS[check.name] ?? Server;
  const StatusIcon = tone.icon;
  const fake = check.detail.includes('local/fake');

  return (
    <div
      className={cn('flex h-full flex-col gap-stack rounded-xl border bg-surface p-card', tone.wrap)}
    >
      {/* Name left, state right — so a column of tiles scans as a column of
          states rather than as eight paragraphs to read in full. */}
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-label text-foreground">
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{LABELS[check.name] ?? check.name}</span>
        </p>
        <StatusPill tone={tone.pill} className={cn('shrink-0 gap-1', tone.pillClass)}>
          <StatusIcon className="size-3" aria-hidden />
          {tone.word}
        </StatusPill>
      </div>

      <p className="text-body-sm text-muted-foreground">{check.detail}</p>

      {fake ? (
        <p className="text-caption text-warning-subtle-foreground">
          Nothing real is sent or charged through this.
        </p>
      ) : null}

      {!probed ? (
        <p className="mt-auto pt-1 text-caption text-muted-foreground">
          Configuration only — this endpoint does not contact the vendor.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Named rather than drawn.
 *
 * The brief asked for latency, error rates, response times, health history,
 * background jobs, logs and traces. Listing what is missing — and why — is
 * more useful to an operator than a chart of numbers nothing produced, and it
 * is the difference between a console they trust and one they learn to
 * second-guess.
 */
function NotMeasured() {
  const gaps = [
    {
      title: 'Latency and response times',
      why: 'No request-timing middleware runs in production — the performance logger is DEBUG-only, because query logging has real overhead.',
    },
    {
      title: 'Error rates',
      why: 'Errors are logged, not counted. There is no metrics store to count them into.',
    },
    {
      title: 'Health history',
      why: 'Each probe answers for right now and is not written down, so there is nothing to plot.',
    },
    {
      title: 'Background job depth',
      why: 'The queue adapter runs tasks synchronously in this environment, so a pending count would structurally always be zero.',
    },
    { title: 'Logs and traces', why: 'No aggregator or tracer is wired up.' },
  ];

  return (
    <section className="flex flex-col gap-stack">
      <SectionHead
        title="Not measured"
        blurb="Named rather than drawn. A chart of numbers nothing produces is worse than an absent one — this is the screen an operator trusts to decide whether to page somebody."
      />
      <ul className="grid gap-stack sm:grid-cols-2">
        {gaps.map((gap) => (
          <li
            key={gap.title}
            className="rounded-xl border border-dashed border-border p-card text-caption"
          >
            <p className="font-medium text-foreground">{gap.title}</p>
            <p className="text-muted-foreground">{gap.why}</p>
          </li>
        ))}
      </ul>
      <p className="text-caption text-muted-foreground">
        <code>frontend/BACKLOG.md</code> item 50 specifies the collector, the store and the
        retention each of these would need.
      </p>
    </section>
  );
}
