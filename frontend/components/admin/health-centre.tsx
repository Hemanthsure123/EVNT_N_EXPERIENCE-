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
import { fetchHealth, fetchHealthDeep, type HealthCheck, type HealthStatus } from '@/lib/api/admin';
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
/**
 * Which checks were actually CONTACTED — derived from the answer, never from a
 * hard-coded name list.
 *
 * This used to be `new Set(['database', 'cache'])`, which was correct while
 * those were the only two things ever probed. The moment `?deep=1` existed it
 * became a lie in the most damaging direction available on this screen:
 * payments and storage WERE contacted, and would have been filed under
 * "configured" and captioned "not contacted" — an operator told that nothing
 * checked the payment provider when something just had.
 *
 * `unknown` is precisely the backend's word for "configured but not
 * contacted", so the status IS the answer. Deriving it means a new probe
 * appears on the right side of this screen without anyone remembering to
 * update a list.
 */
const wasProbed = (check: HealthCheck) => check.status !== 'unknown';

export function HealthCentre() {
  /**
   * ── DEEP IS OPT-IN, AND STAYS ON ONCE ASKED FOR ─────────────────────────
   *
   * Shallow is the default because a console left open on a wall must not
   * become traffic against Razorpay. Once an operator asks — typically before
   * an on-sale — the poll switches to the deep endpoint, which the backend
   * caches for 60s, so the auto-refresh below costs one vendor round trip a
   * minute rather than one every thirty seconds.
   *
   * The query KEY includes `deep`, so the two answers are separate cache
   * entries. Sharing one would let a cached shallow response render under a
   * "probed" heading — reporting `unknown` for a vendor that was in fact
   * contacted, or worse, the reverse.
   */
  const [deep, setDeep] = React.useState(false);

  const query = useQuery({
    queryKey: ['admin', 'health', { deep }],
    queryFn: deep ? fetchHealthDeep : fetchHealth,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
  });

  const checks = query.data?.checks ?? [];
  const probed = checks.filter(wasProbed);
  const configured = checks.filter((check) => !wasProbed(check));
  const degraded = checks.filter((check) => check.status === 'degraded');
  const fakes = configured.filter((check) => check.detail.includes('local/fake'));

  return (
    <div className="flex flex-col gap-block-lg">
      <header className="flex flex-wrap items-end justify-between gap-stack-lg">
        <div className="min-w-0">
          <h1 className="text-h3">System health</h1>
          <p className="max-w-prose text-body-sm text-muted-foreground">
            {query.data?.deep
              ? 'Deep checks on. The payment provider and storage were actually contacted, and the outbox was inspected. Vendor results are cached for a minute.'
              : 'Refreshed every 30 seconds. Probed checks are contacted on each request; configured ones only report which adapter is wired up.'}
          </p>
        </div>
        {/* The one control on a read-only screen, and auto-refresh already
            covers the common case — so it is a quiet outline button, not the
            near-black pill. Nothing here should out-rank the tiles. */}
        <div className="flex flex-wrap items-center gap-2">
          {/* The deep toggle. An outline pill like Refresh rather than a
              switch, because it is an ACTION with a cost (it contacts third
              parties) rather than a preference — and because it changes what
              the tiles beside it MEAN, which a switch buried in a settings row
              would not communicate. */}
          <Button
            type="button"
            variant={deep ? 'secondary' : 'outline'}
            onClick={() => setDeep((on) => !on)}
            aria-pressed={deep}
            leftIcon={<Zap className="size-4" aria-hidden />}
          >
            {deep ? 'Deep checks on' : 'Run deep checks'}
          </Button>
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
        </div>
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
              blurb="Which adapter is configured. These are not probed."
            />
            <ul className="grid gap-stack sm:grid-cols-2 xl:grid-cols-3">
              {configured.map((check) => (
                <li key={check.name}>
                  <HealthTile check={check} probed={false} />
                </li>
              ))}
            </ul>
          </section>

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
      className={cn(
        'flex h-full flex-col gap-stack rounded-xl border bg-surface p-card',
        tone.wrap,
      )}
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

/*
 * A `NotMeasured` section lived here — five dashed cards naming what this
 * console does not monitor (latency, error rates, health history, queue depth,
 * traces) with a sentence each on why.
 *
 * The instinct was sound and this codebase keeps it elsewhere: never draw a
 * chart from numbers nothing produced. But the tiles above ALREADY carry that
 * honesty in the only place it changes a decision — an unprobed dependency
 * reports `unknown` and says which adapter is configured, rather than showing
 * green because nobody looked. A second section restating the gaps added no
 * information and turned an operations screen into a list of what we have not
 * built.
 *
 * If any of these gets a collector, it becomes a tile. Until then it is
 * absent, not announced.
 */
