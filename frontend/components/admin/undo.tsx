'use client';

import * as React from 'react';
import { AlertTriangle, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

/**
 * Undo, instead of "Are you sure?".
 *
 * ── WHY THIS IS THE BETTER TRADE ──────────────────────────────────────────
 *
 * A confirmation dialog taxes every action to prevent the rare mistake, and
 * people learn to dismiss it without reading — so it stops preventing the
 * mistake while continuing to charge for it. Undo reverses that: the common
 * case is one click, and the rare case is one more.
 *
 * ── IT IS A REAL REVERSAL, NOT A DELAY ────────────────────────────────────
 *
 * This does NOT hold the action for five seconds and then send it. The write
 * goes immediately, and Undo issues the COMPENSATING write — reinstate for a
 * suspension, unpublish for an approval. That matters because a deferred
 * action is a lie about what has happened: an operator who closes the tab
 * during the countdown would find nothing had been done. Here, what the toast
 * says has already happened, and the offer is to put it back.
 *
 * Which is exactly why only genuinely REVERSIBLE actions may use this. An
 * approval that has already emailed the organizer is reversible in the
 * database and not in their inbox — so the caller decides, and the ones that
 * cannot be taken back keep their confirmation step.
 *
 * ── THE TOAST NEVER STEALS FOCUS ──────────────────────────────────────────
 *
 * `role="status"` with `aria-live="polite"`: it announces after whatever the
 * operator is doing, rather than interrupting mid-sentence. The Undo button is
 * reachable by Tab and by a shortcut, so it is never mouse-only.
 *
 * ── IT IS QUIET, AND IT IS ON TOP ─────────────────────────────────────────
 *
 * Undo is an OFFER, not the task — so it is the shared `<Button>` in its quiet
 * `secondary` fill rather than the near-black primary pill, which on this
 * console belongs to whatever the operator came to the screen to do. Both
 * controls are full 44px targets, because the one moment somebody reaches for
 * this is the moment they are moving fast.
 *
 * The host sits at `z-toast`, above modals and drawers. It was `z-sticky`,
 * which put it UNDER any dialog — an undo offer hidden behind the thing you
 * just did is the same as no undo offer.
 */

export type UndoableAction = {
  /** What just happened, in the past tense: "Suspended asha@example.com". */
  message: string;
  /** The compensating write. Its rejection is shown rather than swallowed. */
  undo: () => Promise<unknown>;
};

type Toast = UndoableAction & { id: number; state: 'idle' | 'undoing' | 'failed'; error?: string };

/** Long enough to notice and react to; short enough not to linger over a queue. */
const DISMISS_AFTER_MS = 8000;

const UndoContext = React.createContext<{ offer: (action: UndoableAction) => void } | null>(null);

export function UndoProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const counter = React.useRef(0);

  const offer = React.useCallback((action: UndoableAction) => {
    const id = (counter.current += 1);
    setToasts((current) => [...current, { ...action, id, state: 'idle' }]);
    window.setTimeout(
      () =>
        // Only auto-dismiss an untouched toast. One mid-undo, or one showing a
        // failure, must stay until the operator has seen the outcome.
        setToasts((current) => current.filter((toast) => toast.id !== id || toast.state !== 'idle')),
      DISMISS_AFTER_MS,
    );
  }, []);

  const dismiss = (id: number) => setToasts((current) => current.filter((t) => t.id !== id));

  const run = async (toast: Toast) => {
    setToasts((current) =>
      current.map((item) => (item.id === toast.id ? { ...item, state: 'undoing' } : item)),
    );
    try {
      await toast.undo();
      dismiss(toast.id);
    } catch (thrown) {
      // A failed undo is the worst moment to be quiet: the operator believes
      // they put something back and it is still changed.
      setToasts((current) =>
        current.map((item) =>
          item.id === toast.id
            ? {
                ...item,
                state: 'failed',
                error: thrown instanceof Error ? thrown.message : 'Could not undo that.',
              }
            : item,
        ),
      );
    }
  };

  // ⌘Z / Ctrl+Z undoes the most recent offer, unless a field has focus — where
  // it means the browser's own text undo, which is what someone mid-edit
  // expects.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const latest = [...toasts].reverse().find((toast) => toast.state === 'idle');
      if (!latest) return;
      event.preventDefault();
      void run(latest);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toasts]);

  return (
    <UndoContext.Provider value={{ offer }}>
      {children}

      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-block z-toast flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex w-full max-w-md items-center gap-stack rounded-xl border py-2 pl-card pr-2 shadow-lg',
              'animate-in slide-in-from-bottom-2 fade-in-0 motion-reduce:animate-none',
              toast.state === 'failed'
                ? 'border-destructive-subtle bg-destructive-subtle text-destructive-subtle-foreground'
                : 'border-border bg-surface text-foreground',
            )}
          >
            {toast.state === 'failed' ? (
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
            ) : null}

            <p className="min-w-0 flex-1 truncate text-body-sm">
              {toast.state === 'failed' ? `Could not undo: ${toast.error}` : toast.message}
            </p>

            {toast.state === 'failed' ? null : (
              <Button
                type="button"
                variant="secondary"
                disabled={toast.state === 'undoing'}
                loading={toast.state === 'undoing'}
                onClick={() => void run(toast)}
                leftIcon={<Undo2 className="size-4" aria-hidden />}
                className="shrink-0"
              >
                Undo
              </Button>
            )}

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
              className={cn(
                'shrink-0',
                toast.state === 'failed'
                  ? 'text-current hover:bg-destructive-subtle-foreground/10'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        ))}
      </div>
    </UndoContext.Provider>
  );
}

/**
 * Offer an undo for something that has ALREADY happened.
 *
 * Returns a no-op outside a provider rather than throwing: a component that
 * renders in a context without the toast host should still perform its action,
 * just without the offer. Losing the undo affordance is much better than
 * losing the page.
 */
export function useUndo() {
  const context = React.useContext(UndoContext);
  return context ?? { offer: () => {} };
}
