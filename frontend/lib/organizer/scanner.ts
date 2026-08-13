'use client';

import * as React from 'react';

/**
 * Camera QR scanning, using the browser's OWN decoder.
 *
 * ── WHY `BarcodeDetector` AND NOT A LIBRARY ───────────────────────────────
 *
 * Every JS QR decoder is 40–60 KB gzipped of WebAssembly or hand-rolled Reed–
 * Solomon, shipped to every organizer including the ones who scan with a
 * handheld reader and never open the camera. `BarcodeDetector` is native,
 * hardware-accelerated where the platform offers it, and costs zero bytes.
 *
 * The trade is coverage: it is in Chrome and Edge (desktop and Android) and
 * NOT in Safari or Firefox. That is handled by SAYING SO — `isSupported()` is
 * checked before the camera button is offered at all, so a gate steward on an
 * iPhone sees "your browser cannot decode QR, use a handheld scanner" rather
 * than a button that opens a black rectangle. A silently broken camera at a
 * queue is worse than an honest absence.
 *
 * That bundled decoder now EXISTS — `jsqr`, behind a dynamic import, loaded
 * only where the native detector is absent, so the cost falls solely on the
 * browsers that need it. See `fallbackDecoder` below.
 *
 * ── THE DECODER NEVER DECIDES ANYTHING ────────────────────────────────────
 *
 * It turns pixels into a string and hands it over. Whether that string admits
 * anyone is `POST /checkin/verify`'s call, under a per-ticket row lock. This
 * file has no notion of valid.
 */

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function detectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
    .BarcodeDetector;
  return typeof candidate === 'function' ? candidate : null;
}

/** Turns a video frame into a QR string, however this browser can. */
type FrameDecoder = { decode: (video: HTMLVideoElement) => Promise<string | null> };

/**
 * The native path. Free, and what Chrome and Edge take.
 */
function nativeDecoder(): FrameDecoder | null {
  const Ctor = detectorCtor();
  if (!Ctor) return null;
  const detector = new Ctor({ formats: ['qr_code'] });
  return {
    decode: async (video) => {
      const codes = await detector.detect(video);
      return codes[0]?.rawValue?.trim() || null;
    },
  };
}

/**
 * The fallback, for Safari and Firefox — which is to say for iPhones, and so
 * for a large share of the people actually standing on a door.
 *
 * ── IT IS A DYNAMIC IMPORT, AND THAT IS THE POINT ─────────────────────────
 *
 * `jsqr` is only fetched when the native detector is absent, so a Chrome
 * steward downloads none of it. It was chosen over the alternatives on ONE
 * property above all: it has zero dependencies. A decoder with a transitive
 * tree is a decoder that can fail the release's image scan months later for a
 * reason nobody connects to check-in. Verified before adding — the npm audit
 * totals were identical before and after.
 *
 * ── WHY THE FRAME IS SHRUNK ───────────────────────────────────────────────
 *
 * Native detection is done by the browser off the main thread; this runs in
 * JS on it. A full 1080p frame is two million pixels to scan per attempt,
 * which on a mid-range phone drops the video to a slideshow — and a scanner
 * that stutters gets pointed at the code for longer, not less. Downscaling to
 * 640px wide keeps a QR code from a normal scanning distance well above the
 * ~3px-per-module the decoder needs, and costs about a tenth of the work.
 */
async function fallbackDecoder(): Promise<FrameDecoder | null> {
  try {
    const { default: jsQR } = await import('jsqr');
    const canvas = document.createElement('canvas');
    // `willReadFrequently` — without it browsers keep the canvas on the GPU
    // and every `getImageData` pays a readback stall.
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    return {
      decode: async (video) => {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (!width || !height) return null;

        const scale = Math.min(1, 640 / width);
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(image.data, image.width, image.height, {
          // The camera feed is not inverted; skipping the second pass halves
          // the work per frame.
          inversionAttempts: 'dontInvert',
        });
        return found?.data?.trim() || null;
      },
    };
  } catch {
    // A failed chunk fetch must not take the scanner down — the typed field
    // below it still admits people.
    return null;
  }
}

/**
 * Support is now about the CAMERA, not the decoder.
 *
 * This used to require `BarcodeDetector`, so Safari and Firefox were told to
 * use a handheld reader or type the code — which is the manual entry a gate
 * cannot afford at the door. With a fallback decoder, any browser that can
 * open a camera can scan.
 */
export function isScannerSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(navigator?.mediaDevices?.getUserMedia);
}

export type ScannerState = 'idle' | 'starting' | 'running' | 'denied' | 'unsupported' | 'error';

/**
 * A running camera scanner bound to a `<video>`.
 *
 * ── THE SAME CODE IS NOT REPORTED TWICE IN A ROW ──────────────────────────
 *
 * A QR code sits in frame for a second or more, which at 10 fps is a dozen
 * detections of one ticket. Without suppression the gate would fire a dozen
 * verify calls, and the second through twelfth would all come back
 * `denied_already_used` — turning a successful admission into a wall of red.
 * So an identical value is ignored until `repeatAfterMs` has passed, which is
 * long enough to cover a person walking through and short enough that a
 * deliberate re-scan still works.
 */
export function useCameraScanner({
  onDecode,
  repeatAfterMs = 3000,
}: {
  onDecode: (value: string) => void;
  repeatAfterMs?: number;
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const frameRef = React.useRef<number | null>(null);
  const lastRef = React.useRef<{ value: string; at: number }>({ value: '', at: 0 });
  // Held in a ref as well as state: the animation loop closes over its first
  // render, so reading `onDecode` from state there would call a stale handler
  // with a stale event id — i.e. scan somebody into the wrong event.
  const handlerRef = React.useRef(onDecode);
  handlerRef.current = onDecode;

  const [state, setState] = React.useState<ScannerState>('idle');
  const [message, setMessage] = React.useState('');

  const stop = React.useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    // Every track, explicitly. Dropping the reference alone leaves the camera
    // light on until GC runs, which reads as "this site is watching me".
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setState('idle');
  }, []);

  const start = React.useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unsupported');
      return;
    }

    setState('starting');
    setMessage('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // The REAR camera on a phone. `facingMode` is a hint rather than a
        // guarantee, but without it a handheld steward gets a selfie view.
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        setState('idle');
        return;
      }
      video.srcObject = stream;
      // `playsInline` matters on iOS, where a video otherwise goes fullscreen
      // and hides the whole scanner UI behind the system player.
      video.playsInline = true;
      video.muted = true;
      await video.play();

      // Native if the browser has it, otherwise the lazily-imported decoder.
      // Resolved AFTER the camera is up so the import overlaps with the
      // permission prompt rather than delaying it.
      const decoder = nativeDecoder() ?? (await fallbackDecoder());
      if (!decoder) {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setState('error');
        setMessage('The QR reader could not be loaded. Use a handheld scanner or type the code.');
        return;
      }
      setState('running');

      const tick = async () => {
        const element = videoRef.current;
        if (!element || !streamRef.current) return;
        // `readyState < 2` means no frame has decoded yet; passing that to the
        // detector throws rather than returning nothing.
        if (element.readyState >= 2) {
          try {
            const value = await decoder.decode(element);
            if (value) {
              const now = Date.now();
              const last = lastRef.current;
              if (value !== last.value || now - last.at > repeatAfterMs) {
                lastRef.current = { value, at: now };
                handlerRef.current(value);
              }
            }
          } catch {
            // A single failed frame is normal — motion blur, a partial code,
            // a frame delivered mid-resize. Stopping the loop over one is how
            // a scanner dies silently halfway through a queue.
          }
        }
        frameRef.current = requestAnimationFrame(() => void tick());
      };
      frameRef.current = requestAnimationFrame(() => void tick());
    } catch (thrown) {
      const error = thrown as { name?: string };
      if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
        setState('denied');
        setMessage(
          'Camera access was refused. Allow it in your browser’s site settings, or use a handheld scanner.',
        );
      } else if (error?.name === 'NotFoundError') {
        setState('error');
        setMessage('No camera found on this device.');
      } else {
        setState('error');
        setMessage('The camera could not be started.');
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, [repeatAfterMs]);

  // Stop on unmount. A camera left running after navigation is both a battery
  // drain and a privacy indicator nobody can explain.
  React.useEffect(() => stop, [stop]);

  return { videoRef, state, message, start, stop, supported: isScannerSupported() };
}

/**
 * Scan feedback, as sound.
 *
 * ── WHY NOT AUDIO FILES ───────────────────────────────────────────────────
 *
 * Two oscillator beeps against three network-fetched MP3s that must be
 * preloaded, cached, and decoded before the first scan — at a gate, a sound
 * that arrives half a second late is worse than none, because the steward has
 * already looked down at the screen.
 *
 * ── THE TWO TONES ARE DISTINGUISHABLE WITHOUT LOOKING ─────────────────────
 *
 * That is the entire point: a rising two-note chirp for admitted, a low buzz
 * for denied. A steward at a busy gate is looking at the person, not the
 * phone, so the sounds have to differ in PITCH DIRECTION rather than just in
 * length — which also makes them work for someone who cannot see the screen's
 * colour change.
 */
export class ScanSound {
  private context: AudioContext | null = null;

  /** Must be called from a user gesture — browsers refuse to start audio
   *  otherwise, and a silently suspended context is how "the beep stopped
   *  working" bugs happen. */
  unlock(): void {
    if (this.context) {
      void this.context.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) this.context = new Ctor();
  }

  allowed(): void {
    this.play([660, 990], 0.09);
  }

  denied(): void {
    this.play([220, 180], 0.22);
  }

  private play(notes: number[], duration: number): void {
    const context = this.context;
    if (!context || context.state === 'closed') return;
    void context.resume();

    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;

      const start = context.currentTime + index * duration;
      // Ramped rather than switched: an instant gain change produces an
      // audible click on every beep, which over a few hundred scans is
      // genuinely unpleasant to stand next to.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration);
    });
  }

  close(): void {
    void this.context?.close();
    this.context = null;
  }
}
