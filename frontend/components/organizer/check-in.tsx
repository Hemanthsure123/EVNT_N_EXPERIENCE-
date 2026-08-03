'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Camera,
  CameraOff,
  Check,
  Loader2,
  QrCode,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from 'lucide-react';
import { fetchAttendance, verifyTicket, type VerifyResult } from '@/lib/api/organizer-writes';
import { ApiError } from '@/lib/api/errors';
import { useEventRows } from '@/lib/organizer/queries';
import { ScanSound, useCameraScanner } from '@/lib/organizer/scanner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';
import { Gauge } from './charts';
import { EmptyState, ErrorState, Panel, Skeleton } from './primitives';

/**
 * The gate.
 *
 * ── THE VERDICT IS THE SERVER'S, ALWAYS ───────────────────────────────────
 *
 * `POST /checkin/verify` decides under a per-ticket row lock, which is what
 * makes one ticket admit exactly one person even when two gates scan it in the
 * same millisecond. Nothing here pre-judges a token, caches a verdict, or
 * shows green before the response lands. A denial comes back as HTTP 200 with
 * `allowed: false` — it is a valid result, not an error, and it is rendered as
 * an answer rather than as a failure.
 *
 * ── THE VERDICT IS BUILT FOR A GLANCE, NOT A READ ─────────────────────────
 *
 * A steward is looking at the person in front of them, not the screen. So the
 * answer is a full-width band of colour with one word in it, set at heading
 * scale so it is readable at arm's length in daylight, plus a sound that
 * differs in PITCH DIRECTION rather than just in length — a rising chirp for
 * admitted, a low buzz for denied. Either channel alone is enough to keep the
 * queue moving, which also means it works for a steward who cannot see the
 * colour change and for one who cannot hear.
 *
 * ── ONE FILLED BUTTON, AND IT IS "VERIFY" ─────────────────────────────────
 *
 * Verify is the only thing on this screen that acts on a person, so it is the
 * only near-black pill; the sound toggle and the camera switch are outlined,
 * and the event/gate selectors are fields. A screen where four controls all
 * look pressable equally is a screen where the wrong one gets pressed at 8pm
 * with fifty people waiting.
 *
 * The verdict's own colours are the semantic tokens (`success` / `destructive`
 * / `warning`), which have separately tuned light and dark values — a gate
 * runs on whatever device and whatever theme the steward brought.
 *
 * ── OFFLINE ───────────────────────────────────────────────────────────────
 *
 * Scans made offline are QUEUED and replayed on reconnect, and the UI says
 * "queued", never "admitted". That distinction is the whole point: a gate that
 * flashes green while offline would admit two people on one ticket, which is
 * precisely the failure the row lock exists to prevent. The queue is a
 * delivery mechanism, not a decision.
 *
 * ── THREE INPUT PATHS, ALL REAL ───────────────────────────────────────────
 *
 * 1. **Handheld reader** — USB or Bluetooth, types the token and presses
 *    Enter. The field handles that natively and re-focuses after every scan.
 * 2. **Camera** — the browser's own `BarcodeDetector`, so it costs zero bytes.
 *    Offered ONLY where the browser has it (Chrome/Edge); Safari and Firefox
 *    are told plainly to use a reader rather than shown a dead button.
 * 3. **Typed or pasted** — for a code read off a printout.
 */

type Scan = {
  id: string;
  token: string;
  at: number;
  result: VerifyResult | null;
  /** Set while the scan is waiting for the network. */
  queued?: boolean;
  error?: string;
};

const DENIAL_COPY: Record<string, string> = {
  denied_invalid: 'Not a valid ticket — the signature does not check out.',
  denied_already_used: 'Already checked in. This ticket has been used.',
  denied_wrong_event: 'This ticket is for a different event.',
  denied_not_active: 'This ticket was refunded or voided.',
  denied_out_of_window: 'Outside the check-in window for this event.',
};

/**
 * A native `<select>`, not the design system's Radix one, and deliberately so:
 * on the phone a steward is actually holding, the native control opens the OS
 * picker, which is faster and more reliable than any scripted listbox. It wears
 * the same token contract the shared `Input` does, so it lines up with the
 * fields beside it in both themes.
 */
const FIELD_CLASSES =
  'h-control w-full rounded-md border border-input bg-surface px-3 text-body-sm text-foreground shadow-sm transition duration-fast ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

export function CheckIn() {
  const events = useEventRows({ status: 'live' });
  // Memoised because the effect below depends on it; a fresh array identity
  // every render would re-run the "pick a default event" effect constantly.
  const rows = React.useMemo(
    () => events.data?.pages.flatMap((page) => page.data) ?? [],
    [events.data],
  );

  const [eventId, setEventId] = React.useState('');
  const [gate, setGate] = React.useState('Main gate');
  const [token, setToken] = React.useState('');
  const [scans, setScans] = React.useState<Scan[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [online, setOnline] = React.useState(true);
  const [sound, setSound] = React.useState(true);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const sounder = React.useRef<ScanSound | null>(null);

  React.useEffect(() => {
    if (!eventId && rows.length) setEventId(rows[0].id);
  }, [rows, eventId]);

  React.useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  React.useEffect(() => {
    const instance = new ScanSound();
    sounder.current = instance;
    return () => instance.close();
  }, []);

  const attendance = useQuery({
    queryKey: ['organizer', 'attendance', eventId],
    queryFn: () => fetchAttendance(eventId),
    enabled: Boolean(eventId),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });

  // The live values the scanner loop reads. The camera's animation frame
  // closes over its first render, so without refs it would post scans against
  // whichever event was selected when the camera started — i.e. admit somebody
  // to the wrong event after switching.
  const contextRef = React.useRef({ eventId, gate, sound });
  contextRef.current = { eventId, gate, sound };

  const submit = React.useCallback(
    async (raw: string) => {
      const value = raw.trim();
      const { eventId: currentEvent, gate: currentGate, sound: soundOn } = contextRef.current;
      if (!value || !currentEvent) return;
      setToken('');
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      if (!navigator.onLine) {
        // Queued, NOT admitted. Never green, and no confirming chirp — the
        // sound would say "let them in" when nothing has decided.
        setScans((current) => [
          { id, token: value, at: Date.now(), result: null, queued: true },
          ...current,
        ]);
        return;
      }

      setBusy(true);
      setScans((current) => [{ id, token: value, at: Date.now(), result: null }, ...current]);
      try {
        const result = await verifyTicket({
          event_id: currentEvent,
          qr_token: value,
          gate: currentGate,
        });
        setScans((current) => current.map((scan) => (scan.id === id ? { ...scan, result } : scan)));
        if (soundOn) {
          if (result.allowed) sounder.current?.allowed();
          else sounder.current?.denied();
        }
        void attendance.refetch();
      } catch (thrown) {
        setScans((current) =>
          current.map((scan) =>
            scan.id === id
              ? {
                  ...scan,
                  error:
                    thrown instanceof ApiError
                      ? thrown.message
                      : 'Could not reach the server. The scan was not recorded.',
                }
              : scan,
          ),
        );
        if (soundOn) sounder.current?.denied();
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [attendance],
  );

  const camera = useCameraScanner({ onDecode: (value) => void submit(value) });

  // Replay the queue when the connection comes back.
  React.useEffect(() => {
    if (!online) return;
    const queued = scans.filter((scan) => scan.queued);
    if (queued.length === 0) return;
    for (const scan of queued) {
      setScans((current) => current.filter((candidate) => candidate.id !== scan.id));
      void submit(scan.token);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const latest = scans[0];
  const admitted = scans.filter((scan) => scan.result?.allowed).length;
  const denied = scans.filter((scan) => scan.result && !scan.result.allowed).length;

  if (events.isPending) return <Skeleton className="h-96 w-full" />;

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface">
        <EmptyState
          icon={QrCode}
          title="No published events to scan for"
          body="The scanner needs a live event. Publish one and it appears in the selector here."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-stack-lg">
      {!online ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-xl border border-warning bg-warning-subtle px-card py-2.5 text-body-sm text-warning-subtle-foreground"
        >
          <WifiOff className="size-4 shrink-0" aria-hidden />
          Offline. Scans are queued and sent when the connection returns — nobody is admitted until
          the server has decided.
        </p>
      ) : null}

      <div className="grid gap-stack-lg xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-stack-lg">
          {/* The verdict comes FIRST on the page, above the controls. At a gate
              the answer is what you look at; the event selector is set once at
              the start of the night. */}
          <Verdict scan={latest} />

          <Panel
            title="Scan a ticket"
            actions={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  // Unlocked from this click: browsers refuse to start audio
                  // outside a user gesture, and a silently suspended context is
                  // how "the beep stopped working" bugs happen.
                  sounder.current?.unlock();
                  setSound((value) => !value);
                }}
                aria-pressed={sound}
                className="shrink-0 text-muted-foreground"
              >
                {sound ? (
                  <Volume2 className="size-3.5" aria-hidden />
                ) : (
                  <VolumeX className="size-3.5" aria-hidden />
                )}
                {sound ? 'Sound on' : 'Sound off'}
              </Button>
            }
          >
            <div className="flex flex-col gap-stack-lg p-card">
              <div className="grid gap-stack sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-caption font-medium text-muted-foreground">Event</span>
                  <select
                    value={eventId}
                    onChange={(event) => setEventId(event.target.value)}
                    className={FIELD_CLASSES}
                  >
                    {rows.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-caption font-medium text-muted-foreground">Gate</span>
                  <Input
                    value={gate}
                    onChange={(event) => setGate(event.target.value)}
                    className="text-body-sm"
                  />
                </label>
              </div>

              <CameraPanel camera={camera} onUnlockSound={() => sounder.current?.unlock()} />

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  sounder.current?.unlock();
                  void submit(token);
                }}
                className="flex flex-col gap-2"
              >
                <label
                  htmlFor="qr-token"
                  className="text-caption font-medium text-muted-foreground"
                >
                  Ticket code
                </label>
                <div className="flex flex-wrap gap-2">
                  <Input
                    id="qr-token"
                    ref={inputRef}
                    value={token}
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="Scan with a handheld reader, or paste the code"
                    className="h-control-lg min-w-0 flex-1 font-mono text-body-sm placeholder:font-sans"
                  />
                  {/* THE action on this screen. */}
                  <Button type="submit" size="lg" disabled={busy || !token.trim()}>
                    Verify
                  </Button>
                </div>
                <p className="text-caption text-muted-foreground">
                  A USB or Bluetooth reader types the code and presses Enter — this field handles
                  that natively and re-focuses itself after every scan, so a queue keeps moving.
                </p>
              </form>
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-stack-lg">
          <Panel title="Live attendance" subtitle="Counted from used tickets">
            <div className="p-card">
              {attendance.isError ? (
                <ErrorState onRetry={() => void attendance.refetch()} className="px-0 py-0" />
              ) : attendance.isPending ? (
                <Skeleton className="h-20 w-full" />
              ) : (
                <AttendanceRing
                  admitted={attendance.data.admitted}
                  capacity={attendance.data.capacity}
                />
              )}
            </div>
          </Panel>

          <Panel title="This session" subtitle="Since you opened this page">
            <dl className="grid grid-cols-2 divide-x divide-border">
              <div className="p-card">
                <dt className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
                  Admitted
                </dt>
                <dd className="text-h3 tabular-nums text-success">{admitted}</dd>
              </div>
              <div className="p-card">
                <dt className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
                  Turned away
                </dt>
                <dd className="text-h3 tabular-nums text-destructive">{denied}</dd>
              </div>
            </dl>
            <p className="border-t border-border px-card py-2.5 text-caption text-muted-foreground">
              A device count, not the event&rsquo;s. The ring above is the authoritative total
              across every gate.
            </p>
          </Panel>

          <Panel title="Recent scans">
            {scans.length === 0 ? (
              <p className="px-card py-6 text-center text-caption text-muted-foreground">
                Scans appear here as you make them.
              </p>
            ) : (
              <ul className="max-h-80 divide-y divide-border overflow-y-auto">
                {scans.slice(0, 30).map((scan) => (
                  <li key={scan.id} className="flex items-center gap-2.5 px-card py-2">
                    <ScanDot scan={scan} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-caption text-foreground">
                        {scan.result
                          ? scan.result.allowed
                            ? (scan.result.ticket_type ?? 'Admitted')
                            : (DENIAL_COPY[scan.result.reason] ?? scan.result.reason)
                          : scan.queued
                            ? 'Queued — waiting for the connection'
                            : (scan.error ?? 'Checking…')}
                      </span>
                      <span className="block truncate font-mono text-caption text-muted-foreground">
                        {scan.token.slice(0, 28)}
                        {scan.token.length > 28 ? '…' : ''}
                      </span>
                    </span>
                    <time
                      className="shrink-0 text-caption tabular-nums text-muted-foreground"
                      dateTime={new Date(scan.at).toISOString()}
                    >
                      {new Date(scan.at).toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/**
 * The camera.
 *
 * Rendered as an explicit opt-in rather than started on mount: a page that
 * turns on the camera by itself is alarming, and at most gates the handheld
 * reader is faster anyway. Where the browser cannot decode QR at all, this
 * says so in one sentence instead of offering a button that opens a black
 * rectangle.
 */
function CameraPanel({
  camera,
  onUnlockSound,
}: {
  camera: ReturnType<typeof useCameraScanner>;
  onUnlockSound: () => void;
}) {
  if (!camera.supported) {
    return (
      <p className="rounded-xl border border-dashed border-border p-card text-caption text-muted-foreground">
        This browser cannot decode QR codes from a camera — that is a Chrome and Edge capability (
        <code>BarcodeDetector</code>), and Safari and Firefox do not have it yet. Use a handheld
        reader or the field below. Shipping a decoder library for those browsers is BACKLOG
        &ldquo;Bundled QR decoder&rdquo;.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onUnlockSound();
            if (camera.state === 'running' || camera.state === 'starting') camera.stop();
            else void camera.start();
          }}
        >
          {camera.state === 'running' ? (
            <>
              <CameraOff className="size-3.5" aria-hidden />
              Stop camera
            </>
          ) : (
            <>
              <Camera className="size-3.5" aria-hidden />
              Use the camera
            </>
          )}
        </Button>
        {camera.state === 'starting' ? (
          <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Starting…
          </span>
        ) : null}
      </div>

      {camera.message ? (
        <p role="alert" className="text-caption text-destructive">
          {camera.message}
        </p>
      ) : null}

      {/* Kept MOUNTED but hidden when idle: the ref has to exist before
          `start()` can attach the stream to it. */}
      <div
        className={cn(
          'relative overflow-hidden rounded-xl bg-muted',
          camera.state !== 'running' && 'hidden',
        )}
      >
        <video
          ref={camera.videoRef}
          className="aspect-video w-full object-cover"
          muted
          playsInline
        />
        {/* The aiming frame. Purely a target for the person holding the phone —
            the decoder reads the whole frame, not just this box. */}
        <span
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          aria-hidden
        >
          <span className="size-40 rounded-2xl border-2 border-on-gradient/80 shadow-lg" />
        </span>
        <p className="absolute inset-x-0 bottom-0 bg-overlay/70 px-3 py-1.5 text-center text-caption text-on-gradient">
          Hold the ticket&rsquo;s QR code in the frame
        </p>
      </div>
    </div>
  );
}

/**
 * The answer, at arm's length.
 *
 * `aria-live="assertive"` rather than polite: this interrupts on purpose. It
 * is the one thing on the page a screen-reader user must hear immediately,
 * because the queue is already moving.
 */
function Verdict({ scan }: { scan: Scan | undefined }) {
  if (!scan) {
    return (
      <div
        className="flex min-h-32 items-center justify-center rounded-xl border border-dashed border-border p-card-lg text-center"
        aria-live="assertive"
      >
        <p className="text-body-sm text-muted-foreground">
          Ready. Scan a ticket and the verdict appears here.
        </p>
      </div>
    );
  }

  if (scan.queued) {
    return (
      <VerdictBand
        tone="queued"
        title="Queued"
        detail="Held until the connection returns. Nobody has been admitted."
      />
    );
  }

  if (scan.error) {
    return <VerdictBand tone="error" title="Not recorded" detail={scan.error} />;
  }

  if (!scan.result) {
    return (
      <VerdictBand tone="pending" title="Checking…" detail="Waiting for the gate to decide." />
    );
  }

  if (scan.result.allowed) {
    return (
      <VerdictBand
        tone="allowed"
        title="Let them in"
        detail={
          [scan.result.ticket_type, scan.result.gate].filter(Boolean).join(' · ') || 'Admitted'
        }
      />
    );
  }

  return (
    <VerdictBand
      tone="denied"
      title="Do not admit"
      detail={DENIAL_COPY[scan.result.reason] ?? scan.result.reason}
    />
  );
}

/**
 * Every band is a semantic tint plus its own verified foreground, so the
 * verdict is as readable on a dark phone at a night gate as on a bright one at
 * a matinee. The border is the SOLID step of the same token, which is what
 * gives the band an edge on a dark canvas, where a shadow does nothing.
 */
const BANDS = {
  allowed: { wrap: 'border-success bg-success-subtle text-success-subtle-foreground', icon: Check },
  denied: {
    wrap: 'border-destructive bg-destructive-subtle text-destructive-subtle-foreground',
    icon: X,
  },
  queued: {
    wrap: 'border-warning bg-warning-subtle text-warning-subtle-foreground',
    icon: WifiOff,
  },
  error: {
    wrap: 'border-destructive bg-destructive-subtle text-destructive-subtle-foreground',
    icon: X,
  },
  pending: { wrap: 'border-border bg-surface text-muted-foreground', icon: Loader2 },
} as const;

function VerdictBand({
  tone,
  title,
  detail,
}: {
  tone: keyof typeof BANDS;
  title: string;
  detail: string;
}) {
  const band = BANDS[tone];
  const Icon = band.icon;
  return (
    <div
      role="status"
      aria-live="assertive"
      className={cn(
        'flex min-h-32 items-center gap-4 rounded-xl border-2 p-card',
        'animate-in fade-in-0 zoom-in-95 motion-reduce:animate-none',
        band.wrap,
      )}
    >
      {/* A SOLID surface disc, not a translucent one: over the dark theme's
          deep tint an alpha wash composites to a muddy blur, and the icon is
          the half of the answer a steward reads before the words. */}
      <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-full bg-surface">
        <Icon className={cn('size-8', tone === 'pending' && 'animate-spin')} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-h3 sm:text-h2">{title}</span>
        <span className="block text-body-sm">{detail}</span>
      </span>
    </div>
  );
}

function ScanDot({ scan }: { scan: Scan }) {
  const tone = scan.queued
    ? 'bg-warning'
    : scan.error
      ? 'bg-destructive'
      : !scan.result
        ? 'bg-border-strong'
        : scan.result.allowed
          ? 'bg-success'
          : 'bg-destructive';
  return <span className={cn('size-2 shrink-0 rounded-full', tone)} aria-hidden />;
}

/**
 * Admitted against capacity, with the count in the ring rather than under it.
 *
 * The count is the DATABASE's — a used-ticket count reconciled against a Redis
 * counter — so it is the same number at every gate. When capacity is zero the
 * ring is not drawn: a percentage with no denominator is undefined, not 0%.
 *
 * The ring is the neutral `measure` violet and deliberately never green. A
 * green ring sitting a few centimetres from a green "let them in" band would
 * read as a verdict about the person at the gate rather than as a count of the
 * room.
 */
function AttendanceRing({ admitted, capacity }: { admitted: number; capacity: number }) {
  const ratio = capacity > 0 ? Math.min(1, admitted / capacity) : null;

  if (ratio === null) {
    return (
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-h3 tabular-nums text-foreground">{admitted}</p>
        <p className="text-body-sm text-muted-foreground">
          No capacity set for this event, so there is nothing to measure against.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <Gauge ratio={ratio} label={`${admitted} of ${capacity} admitted`} />
        <span className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden>
          <span className="text-h3 tabular-nums text-foreground">{admitted}</span>
          <span className="text-caption tabular-nums text-muted-foreground">of {capacity}</span>
        </span>
      </div>
      <p className="text-caption text-muted-foreground">Admitted across every gate</p>
    </div>
  );
}
