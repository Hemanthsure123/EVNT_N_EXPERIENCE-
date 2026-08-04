'use client';

import * as React from 'react';
import { AlertTriangle, Camera, Trash2, Upload } from 'lucide-react';
import {
  AVATAR_ACCEPT,
  avatarUrlOf,
  checkAvatarFile,
  isUploadCancelled,
  removeAvatar,
  uploadAvatar,
  type AvatarUploadHandle,
} from '@/lib/api/profile';
import { errorMessage } from '@/lib/api/errors';
import { useAuth } from '@/lib/auth/auth-provider';
import { Button, IdentityAvatar } from '@/components/ui';
import { cn } from '@/lib/utils/cn';

/**
 * The profile picture control.
 *
 * ── THE PICTURE ON SCREEN IS THE PROFILE, NOT A LOCAL PREVIEW ─────────────
 *
 * There is no object-URL preview swapped in before the upload finishes. Both
 * endpoints answer with the whole profile, so `applyProfile` replaces the
 * cached user and the SAME `useAuth().user` that feeds the header medallion and
 * the account menu feeds this preview — one source of truth, and the picture
 * changing here is proof it changed everywhere. A local preview would show a
 * picture that is not yet on the account, which is exactly the lie this
 * codebase avoids elsewhere: it looks identical to success when the upload
 * failed.
 *
 * ── PROGRESS AND CANCEL ARE REAL ──────────────────────────────────────────
 *
 * `uploadAvatar` uses XHR precisely so the percentage is genuine (`fetch` has no
 * upload-progress event), and Cancel aborts the request rather than hiding a bar
 * that keeps uploading. A cancel button that does not cancel is worse than none.
 *
 * ── PRE-CHECKS MIRROR THE SERVER; THE SERVER STAYS THE AUTHORITY ──────────
 *
 * `checkAvatarFile` refuses an empty file, one over 10 MB, and a type outside
 * `core.uploads.ALLOWED_IMAGE_TYPES` — instantly, before a byte moves. It
 * cannot do the server's leading-byte test, so a file that passes here can
 * still be refused, and when it is, the SERVER'S OWN message is what is shown.
 * Two different explanations for one file is how somebody concludes the limit is
 * arbitrary.
 *
 * SVG has its own sentence, and it names the reason rather than just refusing:
 * an avatar is the most widely rendered user-supplied image on this platform,
 * and an SVG is a document that can carry script.
 *
 * ── NOTHING HERE IS THE NEAR-BLACK PILL ───────────────────────────────────
 *
 * Choosing a photo is `outline` and Remove is `ghost`. This is a settings
 * surface with no single completable action, so it has no `--cta` fill; the
 * overlay button on the medallion is the affordance that matters, and it is a
 * scrim so it stays legible on any photograph in either theme.
 */
export function AvatarUpload() {
  const { user, applyProfile } = useAuth();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const handleRef = React.useRef<AvatarUploadHandle | null>(null);

  // `null` percent means "no upload in flight", which is a different state from
  // 0% — a stalled 0% bar and no bar at all should not look the same.
  const [percent, setPercent] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState(false);
  const [over, setOver] = React.useState(false);

  const name = user?.full_name || user?.email || '';
  const url = avatarUrlOf(user);
  const busy = percent !== null || removing;

  // Abort on unmount, or a navigation away mid-upload leaves an XHR writing to
  // state that no longer exists.
  React.useEffect(() => () => handleRef.current?.cancel(), []);

  const start = React.useCallback(
    (file: File) => {
      const problem = checkAvatarFile(file);
      if (problem) {
        setError(problem);
        return;
      }
      setError(null);
      setPercent(0);
      const handle = uploadAvatar(file, setPercent);
      handleRef.current = handle;
      handle.promise
        .then((profile) => {
          // The server's payload, adopted whole. Nothing is patched locally.
          applyProfile(profile);
        })
        .catch((cause: unknown) => {
          // A cancel is a decision, not a failure — no error to report.
          if (!isUploadCancelled(cause)) setError(errorMessage(cause));
        })
        .finally(() => {
          handleRef.current = null;
          setPercent(null);
        });
    },
    [applyProfile],
  );

  // Paste support: somebody who just cropped a photo expects ⌘V to work, and it
  // is the shortest path there is. Ignored while an upload is already running so
  // a stray paste cannot replace the file in flight.
  React.useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (busy) return;
      // Never steal a paste aimed at a field. The listener is on `window`
      // because there is no element to focus first — the whole panel is the
      // target — but that also means it sees every paste on the page, and
      // starting an upload because somebody pasted into a text box would be a
      // write they did not ask for.
      // `instanceof` rather than a cast: a paste with nothing focused reports
      // the document as its target, which has no `closest`.
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target && (target.isContentEditable || target.closest('input, textarea, select'))) return;
      const file = Array.from(event.clipboardData?.files ?? [])[0];
      if (file) start(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [busy, start]);

  const remove = () => {
    setError(null);
    setRemoving(true);
    removeAvatar()
      .then(applyProfile)
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setRemoving(false));
  };

  return (
    <section
      // The whole panel is the drop target, not a separate dashed box: the
      // picture is what somebody drags onto.
      onDragOver={(event) => {
        event.preventDefault();
        if (!busy) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (busy) return;
        const file = Array.from(event.dataTransfer.files ?? [])[0];
        if (file) start(file);
      }}
      className={cn(
        'rounded-xl border border-border bg-surface p-card shadow-sm transition-colors duration-fast',
        over && 'border-primary bg-muted',
      )}
      aria-busy={busy || undefined}
    >
      <h2 className="text-body-sm font-semibold">Profile picture</h2>
      <p className="mt-0.5 text-caption text-muted-foreground">
        Shown on your account and next to your name. Drag one in, paste it, or choose a file.
      </p>

      <div className="mt-stack-lg flex items-start gap-4">
        <div className="relative shrink-0">
          <IdentityAvatar name={name || '?'} imageUrl={url} size="xl" />
          {/* The overlay is the primary affordance — the medallion is the thing
              somebody wants to change, so the control sits on it.

              `glass-media` + `text-on-gradient` is the system's existing
              control-on-a-photograph pair (the favourite, share and carousel
              buttons wear it, and globals.css names that set explicitly): a warm
              near-black scrim at 0.66 that does NOT follow the theme, with ink
              verified at 6.36:1 over it. That matters here because what sits
              behind this button is an arbitrary photograph — a theme-adaptive
              surface would put white on white in light mode. It is not `.glass`
              and carries no backdrop blur, for the reason stated there. */}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className={cn(
              'absolute -bottom-1 -right-1 inline-flex size-8 items-center justify-center rounded-full',
              'glass-media border text-on-gradient shadow-sm',
              'transition-opacity duration-fast hover:opacity-90 disabled:pointer-events-none disabled:opacity-60',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
            )}
          >
            <Camera className="size-4" aria-hidden />
            <span className="sr-only">{url ? 'Change profile picture' : 'Add a profile picture'}</span>
          </button>
        </div>

        <div className="min-w-0 flex-1">
          {percent === null ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                leftIcon={<Upload className="size-4" aria-hidden />}
                onClick={() => inputRef.current?.click()}
                disabled={busy}
              >
                {url ? 'Change photo' : 'Upload photo'}
              </Button>
              {/* Only offered when there IS one to remove — a Remove button with
                  nothing to remove implies the initials are a picture. */}
              {url ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  leftIcon={<Trash2 className="size-4" aria-hidden />}
                  onClick={remove}
                  loading={removing}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div
                className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Uploading your profile picture"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-fast ease-out motion-reduce:transition-none"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span className="text-caption tabular-nums text-muted-foreground">{percent}%</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRef.current?.cancel()}
              >
                Cancel
              </Button>
            </div>
          )}

          {/* The rules, in the order the server applies them, and the SVG
              refusal explained rather than asserted. Stated up front so nobody
              exports a 40 MB TIFF to find out. */}
          <p className="mt-2 text-caption text-foreground-subtle">
            JPEG, PNG, WebP, AVIF or GIF, up to 10 MB. SVG is not accepted — it is a document that
            can carry code, and your picture is shown on every page you appear on.
          </p>

          {error ? (
            <p
              role="alert"
              className="mt-2 flex items-start gap-2 rounded-lg border border-destructive-subtle bg-destructive-subtle px-3 py-2 text-caption text-destructive-subtle-foreground"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        // Matches the server's allow-list, so the picker itself filters — and
        // `accept` is a convenience, never the check: it is trivially bypassed.
        accept={AVATAR_ACCEPT}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset first: picking the SAME file twice (after a failure) fires no
          // change event otherwise, and Retry would silently do nothing.
          event.target.value = '';
          if (file) start(file);
        }}
      />
    </section>
  );
}
