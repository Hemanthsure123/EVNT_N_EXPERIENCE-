'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  AnimatePresence,
  LazyMotion,
  domAnimation,
  m,
  useAnimationControls,
  useReducedMotion,
} from 'framer-motion';
import {
  Check,
  ChevronDown,
  Flashlight,
  FlashlightOff,
  Keyboard,
  Loader2,
  ScanLine,
  SwitchCamera,
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
import { ProgressBar } from '@/components/ui';
import { SpotTicket } from '@/components/illustrations/spots';
import { cn } from '@/lib/utils/cn';
import { EmptyState, GLASS_PANEL, Skeleton } from './primitives';

/**
 * THE SCAN DESK — camera first.
 *
 * ── WHAT CHANGED, AND WHAT DID NOT ───────────────────────────────────────
 *
 * The screen was a form: an event select, a Gate field, a "Use the camera"
 * button and a token input, with the verdict and the recent scans ABOVE it —
 * so a steward opening it at a door saw two empty cards and had to scroll to
 * find the thing they came to do. The scanner is now the top of the screen and
 * the first thing it offers, the verdict and the history sit in one card under
 * it, and the Gate field is gone (the backend defaults it to blank).
 *
 * Nothing about the DECISION moved:
 *
 * - **The verdict is the server's, always.** `POST /checkin/verify` decides
 *   under a per-ticket row lock. Nothing here pre-judges a token, caches a
 *   verdict, or shows green before the response lands. A denial is HTTP 200
 *   with `allowed: false` — an answer, rendered as one.
 * - **Offline scans are QUEUED, never admitted.** Replayed on reconnect, and
 *   the flash stays dark for them: a green flash for a scan nobody has decided
 *   would admit two people on one ticket, which is the failure the row lock
 *   exists to prevent.
 * - **The camera is an opt-in.** A page that turns the camera on by itself is
 *   alarming, and at many gates a handheld reader is faster.
 *
 * ── THE FLASH IS FOR THE PERSON HOLDING THE PHONE ────────────────────────
 *
 * Green with a tick, or red with a shake, over the camera itself — because
 * that is where a steward is looking at the moment the answer lands. The band
 * underneath still carries the words and `aria-live="assertive"`, so the
 * answer exists for somebody who cannot see a colour change, and the sound
 * differs in PITCH DIRECTION for somebody who is looking at the guest instead.
 * Under `prefers-reduced-motion` the shake is skipped and the flash only fades.
 *
 * ── LAZYMOTION, NOT `motion` ─────────────────────────────────────────────
 *
 * `m` + `domAnimation` is the ~15 KB subset of framer-motion, not the whole
 * library. This route had no framer at all before, it sits under a 220 KB
 * per-route budget, and a scanner that loads slower on a venue's bad signal is
 * the wrong trade for a shake.
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

/** One flash over the camera. `id` restarts the animation on every scan. */
type Flash = { id: string; tone: 'ok' | 'bad' };

const DENIAL_COPY: Record<string, string> = {
  denied_invalid: 'Not a valid ticket — the signature does not check out.',
  denied_already_used: 'Already checked in. This ticket has been used.',
  denied_wrong_event: 'This ticket is for a different event.',
  denied_not_active: 'This ticket was refunded or voided.',
  denied_out_of_window: 'Outside the check-in window for this event.',
};

/** How long a flash stays up — long enough to read across a table, short
 *  enough that the next person in the queue is not scanned under it. */
const FLASH_MS = 1100;

/** Remembered per device: a desk working from a handheld reader wants the
 *  field open every time, and one scanning by camera wants it out of the way. */
const MANUAL_KEY = 'curatix.scan-desk.manual';

export function ScanDesk() {
  const events = useEventRows({ status: 'live' });
  // Memoised because the effect below depends on it; a fresh array identity
  // every render would re-run the "pick a default event" effect constantly.
  const rows = React.useMemo(
    () => events.data?.pages.flatMap((page) => page.data) ?? [],
    [events.data],
  );

  /**
   * THE DESK CAN BE DEEP-LINKED, AND IT VERIFIES THE LINK.
   *
   * "Scan desk" on an event card arrives as `?event={id}`. Taking that id on
   * trust is the one thing this screen must not do: the `event_id` sent with
   * every scan is what the backend authorizes and wrong-event-checks against,
   * so a desk silently stationed at the wrong event denies an entire queue of
   * valid tickets with `denied_wrong_event`. The id is honoured only if it is
   * in the live list this screen can scan for; anything else falls back AND
   * SAYS SO.
   */
  const params = useSearchParams();
  const requested = params?.get('event') ?? '';
  const [eventId, setEventId] = React.useState('');
  const [ignoredLink, setIgnoredLink] = React.useState(false);
  const eventChosen = React.useRef(false);

  const [token, setToken] = React.useState('');
  const [scans, setScans] = React.useState<Scan[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [online, setOnline] = React.useState(true);
  const [sound, setSound] = React.useState(true);
  const [flash, setFlash] = React.useState<Flash | null>(null);
  const [manualOpen, setManualOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const sounder = React.useRef<ScanSound | null>(null);

  React.useEffect(() => {
    // ONCE, when the list first arrives. Without the latch a steward who
    // changed the event by hand would be dragged back to the link's choice on
    // the next refetch.
    if (eventChosen.current || !rows.length) return;
    eventChosen.current = true;
    if (requested && rows.some((row) => row.id === requested)) {
      setEventId(requested);
      return;
    }
    if (requested) setIgnoredLink(true);
    setEventId(rows[0].id);
  }, [rows, requested]);

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

  // The manual field's remembered state. Read after mount: localStorage does
  // not exist on the server, and reading it during render would hydrate a
  // different tree from the one the server sent.
  React.useEffect(() => {
    try {
      if (window.localStorage.getItem(MANUAL_KEY) === 'open') setManualOpen(true);
    } catch {
      // Private mode or blocked storage: the default is fine.
    }
  }, []);

  const toggleManual = React.useCallback(() => {
    setManualOpen((open) => {
      const next = !open;
      try {
        window.localStorage.setItem(MANUAL_KEY, next ? 'open' : 'closed');
      } catch {
        // Not remembered, and nothing else changes.
      }
      return next;
    });
  }, []);

  React.useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);

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
  const contextRef = React.useRef({ eventId, sound, manualOpen });
  contextRef.current = { eventId, sound, manualOpen };

  const submit = React.useCallback(
    async (raw: string) => {
      const value = raw.trim();
      const { eventId: currentEvent, sound: soundOn } = contextRef.current;
      if (!value || !currentEvent) return;
      setToken('');
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      if (!navigator.onLine) {
        // Queued, NOT admitted. No flash and no chirp — both would say "let
        // them in" when nothing has decided.
        setScans((current) => [
          { id, token: value, at: Date.now(), result: null, queued: true },
          ...current,
        ]);
        return;
      }

      setBusy(true);
      setScans((current) => [{ id, token: value, at: Date.now(), result: null }, ...current]);
      try {
        // No `gate`. The field is gone from this screen and the serializer
        // defaults it to blank, which is what an unnamed desk is.
        const result = await verifyTicket({ event_id: currentEvent, qr_token: value });
        setScans((current) => current.map((scan) => (scan.id === id ? { ...scan, result } : scan)));
        setFlash({ id, tone: result.allowed ? 'ok' : 'bad' });
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
        setFlash({ id, tone: 'bad' });
        if (soundOn) sounder.current?.denied();
      } finally {
        setBusy(false);
        // Back to the field for the next scan — the handheld reader's whole
        // workflow — but only when the field is the input in use. Focusing a
        // collapsed field would pop a phone keyboard up over the camera.
        if (contextRef.current.manualOpen) inputRef.current?.focus();
      }
    },
    [attendance],
  );

  const camera = useCameraScanner({ onDecode: (value) => void submit(value) });

  // A device that cannot scan by camera gets the typed field without asking —
  // hiding the only working input behind a link is a desk that looks broken.
  React.useEffect(() => {
    if (!camera.supported || camera.state === 'denied' || camera.state === 'unsupported') {
      setManualOpen(true);
    }
  }, [camera.supported, camera.state]);

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

  if (events.isPending) return <Skeleton className="mx-auto h-96 w-full max-w-xl" />;

  if (rows.length === 0) {
    return (
      <div className="mx-auto w-full max-w-xl rounded-3xl border border-border bg-surface">
        <EmptyState
          scene={SpotTicket}
          title="No published events to scan for"
          body="The scanner needs a live event. Publish one and it appears in the selector here."
        />
      </div>
    );
  }

  return (
    <LazyMotion features={domAnimation}>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-stack-lg">
        {!online ? (
          <p
            role="status"
            className="flex items-center gap-2 rounded-2xl border border-warning bg-warning-subtle px-card py-2.5 text-body-sm text-warning-subtle-foreground"
          >
            <WifiOff className="size-4 shrink-0" aria-hidden />
            Offline. Scans are queued and sent when the connection returns — nobody is admitted
            until the server has decided.
          </p>
        ) : null}

        {/* ── THE SCANNER, AT THE TOP ────────────────────────────────────── */}
        <section aria-labelledby="scan-desk-heading" className="flex flex-col gap-stack">
          <header className="flex items-center gap-2">
            <h1 id="scan-desk-heading" className="inline-flex items-center gap-2 text-h4">
              <ScanLine className="size-5 text-primary" aria-hidden />
              Scan desk
            </h1>
            <button
              type="button"
              onClick={() => {
                // Unlocked from this press: browsers refuse to start audio
                // outside a user gesture.
                sounder.current?.unlock();
                setSound((value) => !value);
              }}
              aria-pressed={sound}
              aria-label={sound ? 'Sound on' : 'Sound off'}
              title={sound ? 'Sound on' : 'Sound off'}
              className={cn(
                'ml-auto inline-flex size-10 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground',
                'transition-colors duration-fast hover:text-foreground motion-reduce:transition-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              {sound ? (
                <Volume2 className="size-4" aria-hidden />
              ) : (
                <VolumeX className="size-4" aria-hidden />
              )}
            </button>
          </header>

          <EventPicker
            rows={rows}
            value={eventId}
            onChange={setEventId}
            ignoredLink={ignoredLink}
          />

          <Viewport
            camera={camera}
            flash={flash}
            onOpen={() => {
              sounder.current?.unlock();
              void camera.start();
            }}
          />

          <ManualEntry
            open={manualOpen}
            onToggle={toggleManual}
            token={token}
            onToken={setToken}
            busy={busy}
            inputRef={inputRef}
            onSubmit={() => {
              sounder.current?.unlock();
              void submit(token);
            }}
          />
        </section>

        {/* ── THE ANSWER, AND WHAT CAME BEFORE IT ─────────────────────────
            One card under the scanner, in the order a steward looks: the
            verdict of the scan that just happened, then the room, then the
            history. */}
        <section
          aria-label="Results"
          className={cn(GLASS_PANEL, 'flex flex-col gap-stack-lg rounded-3xl p-card shadow-sm')}
        >
          <Verdict scan={latest} />

          <Attendance
            eventId={eventId}
            pending={attendance.isPending}
            error={attendance.isError}
            admitted={attendance.data?.admitted ?? 0}
            capacity={attendance.data?.capacity ?? 0}
          />

          <RecentScans scans={scans} admitted={admitted} denied={denied} />
        </section>
      </div>
    </LazyMotion>
  );
}

/* ---------------------------------------------------------------- the event */

/**
 * Which event this desk admits to.
 *
 * A NATIVE select, deliberately: on the phone a steward is holding, it opens
 * the OS picker, which is faster and more reliable than any scripted listbox.
 */
function EventPicker({
  rows,
  value,
  onChange,
  ignoredLink,
}: {
  rows: { id: string; title: string }[];
  value: string;
  onChange: (value: string) => void;
  ignoredLink: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="relative flex items-center">
        <span className="sr-only">Event</span>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            'h-control w-full appearance-none truncate rounded-full border border-input bg-surface pl-4 pr-10',
            'text-body-sm font-medium text-foreground shadow-sm',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          {rows.map((row) => (
            <option key={row.id} value={row.id}>
              {row.title}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3.5 size-4 text-muted-foreground"
          aria-hidden
        />
      </label>
      {ignoredLink ? (
        <p
          role="alert"
          className="rounded-xl bg-warning-subtle px-3 py-2 text-caption text-warning-subtle-foreground"
        >
          That event is not on sale, so its desk is not open. Showing the first live event instead
          — check this is the right one before scanning.
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- the viewport */

type Camera = ReturnType<typeof useCameraScanner>;

/**
 * THE CAMERA, OR THE INVITATION TO OPEN IT.
 *
 * ── THE `<video>` IS ALWAYS MOUNTED ──────────────────────────────────────
 *
 * `start()` attaches the stream to the element behind `videoRef`, so the ref
 * has to exist before the press — and every state change here (idle, starting,
 * running, a flash, a shake) is a class or an overlay, never a remount. A
 * remount drops the MediaStream attached to the old node and freezes the
 * camera mid-queue. That is also why the shake is driven by animation CONTROLS
 * rather than by re-keying the element.
 */
function Viewport({
  camera,
  flash,
  onOpen,
}: {
  camera: Camera;
  flash: Flash | null;
  onOpen: () => void;
}) {
  const controls = useAnimationControls();
  const reduce = useReducedMotion();
  const running = camera.state === 'running';

  React.useEffect(() => {
    if (!flash || flash.tone !== 'bad' || reduce) return;
    void controls.start({
      x: [0, -10, 10, -7, 7, -3, 3, 0],
      transition: { duration: 0.45, ease: 'easeOut' },
    });
  }, [flash, controls, reduce]);

  return (
    <m.div
      animate={controls}
      className={cn(
        'relative aspect-[4/5] w-full overflow-hidden rounded-3xl shadow-xl',
        running
          ? 'bg-black'
          : 'border border-border bg-gradient-to-b from-primary/10 via-surface to-surface',
      )}
    >
      <video
        ref={camera.videoRef}
        className={cn(
          'absolute inset-0 size-full object-cover',
          // Hidden, never unmounted — see the note on this component.
          !running && 'invisible',
          // The front lens mirrors, so the picture moves the way the hand does.
          camera.facing === 'user' && '-scale-x-100',
        )}
        muted
        playsInline
      />

      {running ? <Reticle /> : null}
      {running ? <CameraControls camera={camera} /> : null}
      {running ? null : <IdleFace camera={camera} onOpen={onOpen} />}

      <AnimatePresence>
        {flash ? <FlashOverlay key={flash.id} tone={flash.tone} /> : null}
      </AnimatePresence>
    </m.div>
  );
}

/**
 * The target, the dark surround and the sweep.
 *
 * The darkened surround is ONE box-shadow on the reticle, spread far enough to
 * cover the viewport and clipped by the viewport's own rounded overflow — so
 * the cut-out is exactly the reticle's shape with no second element to keep
 * aligned with it. The sweep is a transform animation on a layer the full
 * height of the reticle (a `translateY` percentage is of the element's OWN
 * height), so it never touches layout. The decoder reads the whole frame, not
 * just this box: the target is for the person holding the phone.
 */
function Reticle() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
      <div className="relative aspect-square w-[68%]">
        <div
          className="absolute inset-0 rounded-3xl"
          style={{ boxShadow: '0 0 0 100vmax rgb(var(--overlay) / 0.55)' }}
        />

        <Corner className="left-0 top-0 rounded-tl-3xl border-l-4 border-t-4" />
        <Corner className="right-0 top-0 rounded-tr-3xl border-r-4 border-t-4" />
        <Corner className="bottom-0 left-0 rounded-bl-3xl border-b-4 border-l-4" />
        <Corner className="bottom-0 right-0 rounded-br-3xl border-b-4 border-r-4" />

        <div className="absolute inset-0 overflow-hidden rounded-3xl">
          <div className="absolute inset-x-4 top-0 h-full animate-scan-laser motion-reduce:animate-none">
            <span className="block h-0.5 w-full rounded-full bg-primary shadow-lg shadow-primary" />
            <span className="-mt-1.5 block h-3 w-full rounded-full bg-primary/30 blur-md" />
          </div>
        </div>
      </div>

      <p className="absolute inset-x-0 bottom-5 px-card text-center text-caption font-medium text-on-gradient">
        Hold the ticket&rsquo;s QR code inside the frame
      </p>
    </div>
  );
}

function Corner({ className }: { className: string }) {
  return <span className={cn('absolute size-9 border-on-gradient', className)} />;
}

/**
 * Torch, flip and stop, floating on the feed.
 *
 * `glass-media` — the codebase's surface for chrome that sits ON a picture:
 * dark in both themes, so a white glyph stays legible over whatever the lens
 * is pointed at. The blur is affordable here where it is not on a card grid:
 * three 44px buttons, not twenty cards.
 *
 * Torch and flip are drawn only where the hardware said yes — see
 * `useCameraScanner`. A button that does nothing is worse than no button.
 */
function CameraControls({ camera }: { camera: Camera }) {
  const control = cn(
    'glass-media pointer-events-auto inline-flex size-11 items-center justify-center rounded-full border text-on-gradient backdrop-blur-md',
    'transition-transform duration-fast ease-spring active:scale-95 motion-reduce:transition-none',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-gradient',
  );

  return (
    <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
      <button
        type="button"
        onClick={camera.stop}
        aria-label="Close the camera"
        title="Close the camera"
        className={control}
      >
        <X className="size-5" aria-hidden />
      </button>

      <div className="flex items-center gap-2">
        {camera.torchSupported ? (
          <button
            type="button"
            onClick={() => void camera.toggleTorch()}
            aria-pressed={camera.torchOn}
            aria-label={camera.torchOn ? 'Turn the flashlight off' : 'Turn the flashlight on'}
            title="Flashlight"
            className={cn(control, camera.torchOn && 'bg-on-gradient text-foreground')}
          >
            {camera.torchOn ? (
              <Flashlight className="size-5" aria-hidden />
            ) : (
              <FlashlightOff className="size-5" aria-hidden />
            )}
          </button>
        ) : null}
        {camera.canFlip ? (
          <button
            type="button"
            onClick={camera.flip}
            aria-label="Switch camera"
            title="Switch camera"
            className={control}
          >
            <SwitchCamera className="size-5" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Before the camera is on: the art, one sentence, and one button.
 *
 * The button PULSES because it is the single thing this screen wants pressed
 * first; the halo is `animate-ping` and stops under reduced motion. Every
 * other state here — starting, refused, unsupported — says what happened in
 * words and points at the typed field, rather than leaving a dead rectangle.
 */
function IdleFace({ camera, onOpen }: { camera: Camera; onOpen: () => void }) {
  const starting = camera.state === 'starting';
  const blocked = !camera.supported || camera.state === 'unsupported';
  const failed = camera.state === 'denied' || camera.state === 'error';

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-stack-lg p-card-lg text-center">
      <TicketArt />

      <div className="flex max-w-xs flex-col gap-1">
        <p className="text-h4 text-foreground">
          {blocked ? 'No camera here' : failed ? 'The camera is off' : 'Ready to scan'}
        </p>
        <p className="text-body-sm text-muted-foreground">
          {blocked
            ? 'This device cannot open a camera. Enter codes manually below, or use a handheld reader.'
            : failed
              ? camera.message
              : 'Point the camera at a ticket’s QR code and the verdict appears instantly.'}
        </p>
      </div>

      {blocked ? null : (
        <button
          type="button"
          onClick={onOpen}
          disabled={starting}
          className={cn(
            'relative inline-flex h-control-lg items-center gap-2 rounded-full bg-primary px-pill-lg',
            'text-body font-semibold text-primary-foreground shadow-xl shadow-primary/30',
            'transition-transform duration-fast ease-spring active:scale-95 motion-reduce:transition-none',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            'disabled:opacity-80',
          )}
        >
          {starting ? null : (
            <span
              aria-hidden
              className="absolute inset-0 -z-10 animate-ping rounded-full bg-primary/40 motion-reduce:animate-none"
            />
          )}
          {starting ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : (
            <ScanLine className="size-5" aria-hidden />
          )}
          {starting ? 'Starting camera…' : failed ? 'Try again' : 'Tap to open scanner'}
        </button>
      )}
    </div>
  );
}

/**
 * A ticket with a QR on it, tilted in 3D and floating.
 *
 * Drawn, not fetched: no Lottie runtime (~60 KB before the animation file
 * itself) and no image request on a screen that is often opened on a venue's
 * worst signal. The QR modules are a fixed pseudo-random pattern — generated
 * once at module load, so the art is identical on every render and in every
 * snapshot — framed by the three finder squares that make a QR read as one.
 */
function TicketArt() {
  return (
    <div className="[perspective:56rem]" aria-hidden>
      <div className="animate-float-y motion-reduce:animate-none">
        <div
          className={cn(
            'relative flex w-44 flex-col items-center gap-3 rounded-3xl p-4',
            'bg-gradient-to-br from-primary to-primary/75 text-primary-foreground shadow-2xl shadow-primary/30',
            '[transform:rotateX(16deg)_rotateY(-20deg)_rotateZ(3deg)]',
          )}
        >
          {/* The perforation notches, cut from the canvas colour. */}
          <span className="absolute -left-2.5 top-1/2 size-5 -translate-y-1/2 rounded-full bg-background" />
          <span className="absolute -right-2.5 top-1/2 size-5 -translate-y-1/2 rounded-full bg-background" />

          <span className="text-caption font-semibold uppercase tracking-widest opacity-90">
            Admit one
          </span>
          <span className="rounded-2xl bg-surface p-2.5 text-foreground shadow-inner">
            <QrGlyph className="size-24" />
          </span>
          <span className="h-px w-full border-t border-dashed border-primary-foreground/40" />
          <span className="text-caption opacity-80">Curatix</span>
        </div>
      </div>
    </div>
  );
}

const QR_SIZE = 21;

/** Data modules outside the three 7×7 finder regions — deterministic. */
const QR_MODULES: ReadonlyArray<readonly [number, number]> = (() => {
  const inFinder = (x: number, y: number) =>
    (x < 8 && y < 8) || (x > QR_SIZE - 9 && y < 8) || (x < 8 && y > QR_SIZE - 9);
  const cells: [number, number][] = [];
  let seed = 20260915;
  for (let y = 0; y < QR_SIZE; y += 1) {
    for (let x = 0; x < QR_SIZE; x += 1) {
      if (inFinder(x, y)) continue;
      seed = (seed * 1103515245 + 12345) % 2147483648;
      if (seed % 100 < 47) cells.push([x, y]);
    }
  }
  return cells;
})();

function QrGlyph({ className }: { className?: string }) {
  const finder = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width={7} height={7} fill="currentColor" />
      <rect x={x + 1} y={y + 1} width={5} height={5} className="fill-surface" />
      <rect x={x + 2} y={y + 2} width={3} height={3} fill="currentColor" />
    </g>
  );
  return (
    <svg viewBox={`0 0 ${QR_SIZE} ${QR_SIZE}`} className={className} shapeRendering="crispEdges">
      {finder(0, 0)}
      {finder(QR_SIZE - 7, 0)}
      {finder(0, QR_SIZE - 7)}
      {QR_MODULES.map(([x, y]) => (
        <rect key={`${x}:${y}`} x={x} y={y} width={1} height={1} fill="currentColor" />
      ))}
    </svg>
  );
}

/**
 * Green with a tick, or red with a cross — over the camera, for a moment.
 *
 * `pointer-events-none`: the flash must never swallow the press on Close or on
 * the torch that the steward's thumb is already heading for.
 */
function FlashOverlay({ tone }: { tone: Flash['tone'] }) {
  const ok = tone === 'ok';
  return (
    <m.div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 flex items-center justify-center',
        ok ? 'bg-success/35' : 'bg-destructive/35',
      )}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <m.span
        className={cn(
          'inline-flex size-24 items-center justify-center rounded-full shadow-2xl',
          ok ? 'bg-success text-success-foreground' : 'bg-destructive text-destructive-foreground',
        )}
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 22 }}
      >
        {ok ? (
          <Check className="size-12" strokeWidth={3} />
        ) : (
          <X className="size-12" strokeWidth={3} />
        )}
      </m.span>
    </m.div>
  );
}

/* ----------------------------------------------------------- manual entry */

/**
 * "Enter code manually" — collapsed until wanted, and never lost.
 *
 * It is also where a HANDHELD READER types: USB and Bluetooth scanners are
 * keyboards that end with Enter. So the open/closed choice is remembered per
 * device, it opens by itself where the camera cannot work, and after every
 * scan the field takes focus back — but only while it is open, so a camera
 * scan never pops a phone keyboard over the viewport.
 *
 * The expand is a `grid-template-rows` 0fr→1fr transition, which animates to
 * the content's real height without measuring it. While closed the region is
 * `inert`, so the field cannot be tabbed into while it is invisible.
 */
function ManualEntry({
  open,
  onToggle,
  token,
  onToken,
  busy,
  inputRef,
  onSubmit,
}: {
  open: boolean;
  onToggle: () => void;
  token: string;
  onToken: (value: string) => void;
  busy: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  onSubmit: () => void;
}) {
  const regionId = React.useId();
  const regionRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (regionRef.current) regionRef.current.inert = !open;
    if (open) inputRef.current?.focus({ preventScroll: true });
  }, [open, inputRef]);

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={regionId}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-body-sm font-medium text-primary',
          'transition-colors duration-fast hover:bg-primary/10 motion-reduce:transition-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <Keyboard className="size-4" aria-hidden />
        {open ? 'Hide manual entry' : 'Enter code manually'}
        <ChevronDown
          className={cn(
            'size-4 transition-transform duration-slow motion-reduce:transition-none',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      <div
        id={regionId}
        ref={regionRef}
        className={cn(
          'grid w-full transition-[grid-template-rows,opacity] duration-slow ease-out motion-reduce:transition-none',
          open ? '[grid-template-rows:1fr] opacity-100' : '[grid-template-rows:0fr] opacity-0',
        )}
      >
        <div className="overflow-hidden">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
            className="flex gap-2 pt-1"
          >
            <label htmlFor="scan-desk-code" className="sr-only">
              Ticket code
            </label>
            <Input
              id="scan-desk-code"
              ref={inputRef}
              value={token}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => onToken(event.target.value)}
              placeholder="Paste a code, or scan with a reader"
              className="h-control-lg min-w-0 flex-1 rounded-full font-mono text-body-sm placeholder:font-sans"
            />
            <Button type="submit" size="lg" className="rounded-full" disabled={busy || !token.trim()}>
              Verify
            </Button>
          </form>
          <p className="px-3 pt-1.5 text-caption text-muted-foreground">
            Handheld readers type here — the field takes focus back after every scan.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- results */

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
        className="flex min-h-24 items-center justify-center rounded-2xl border border-dashed border-border p-card text-center"
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

  if (scan.error) return <VerdictBand tone="error" title="Not recorded" detail={scan.error} />;

  if (!scan.result) {
    return <VerdictBand tone="pending" title="Checking…" detail="Waiting for the gate to decide." />;
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
        'flex min-h-24 items-center gap-4 rounded-2xl border-2 p-card',
        'animate-in fade-in-0 zoom-in-95 motion-reduce:animate-none',
        band.wrap,
      )}
    >
      {/* A SOLID surface disc, not a translucent one: over the dark theme's
          deep tint an alpha wash composites to a muddy blur, and the icon is
          the half of the answer a steward reads before the words. */}
      <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-surface">
        <Icon className={cn('size-7', tone === 'pending' && 'animate-spin')} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-h4">{title}</span>
        <span className="block text-body-sm">{detail}</span>
      </span>
    </div>
  );
}

/**
 * Admitted against capacity, from the endpoint that owns the number.
 *
 * `checkin` reconciles its Redis counter against the used-ticket count in the
 * database, so this is the same figure at every desk. With no capacity there
 * is no meter: a percentage with no denominator is undefined, not 0%.
 */
function Attendance({
  eventId,
  pending,
  error,
  admitted,
  capacity,
}: {
  eventId: string;
  pending: boolean;
  error: boolean;
  admitted: number;
  capacity: number;
}) {
  if (error) {
    return (
      <p className="text-caption text-muted-foreground">
        Could not load the room count. Scanning still works.
      </p>
    );
  }
  if (pending) return <Skeleton className="h-14 w-full" />;

  const ratio = capacity > 0 ? Math.min(1, admitted / capacity) : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="flex items-baseline gap-1.5">
          <span className="text-h3 tabular-nums text-foreground">{admitted}</span>
          {capacity ? (
            <span className="text-body-sm tabular-nums text-muted-foreground">/ {capacity}</span>
          ) : null}
          <span className="text-caption text-muted-foreground">inside, across every desk</span>
        </p>
        <Link
          href={`/dashboard/events/${eventId}/attendees`}
          className="shrink-0 rounded-full text-caption font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          See everyone
        </Link>
      </div>
      {ratio !== null ? (
        <ProgressBar value={ratio} aria-label={`${admitted} of ${capacity} admitted`} size="md" />
      ) : null}
    </div>
  );
}

function RecentScans({
  scans,
  admitted,
  denied,
}: {
  scans: Scan[];
  admitted: number;
  denied: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-body-sm font-semibold text-foreground">Recent scans</h2>
        {/* A DEVICE count, labelled as one: the room total above is the
            authoritative figure across every desk. */}
        {scans.length ? (
          <p className="text-caption tabular-nums text-muted-foreground">
            {admitted} in · {denied} turned away on this device
          </p>
        ) : null}
      </div>

      {scans.length === 0 ? (
        <p className="py-4 text-center text-caption text-muted-foreground">
          Scans appear here as you make them.
        </p>
      ) : (
        <ul className="max-h-72 divide-y divide-border overflow-y-auto">
          {scans.slice(0, 30).map((scan) => (
            <li key={scan.id} className="flex items-center gap-2.5 py-2">
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
