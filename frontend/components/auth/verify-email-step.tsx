'use client';

import * as React from 'react';
import { MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isApiError } from '@/lib/api/errors';
import { useAuth } from '@/lib/auth/auth-provider';
import type { User } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';

/**
 * The step between "account created" and "signed in".
 *
 * Registration issues NO session — verifying the address is what does — so
 * this is not an optional interstitial that can be skipped or dismissed. It is
 * the only path forward, which is why it replaces the form rather than
 * appearing beside it.
 *
 * ── WHY SIX SEPARATE BOXES AND NOT ONE FIELD ─────────────────────────────
 *
 * A single text input is fewer elements and worse: it gives no feedback about
 * how many digits are expected, and on mobile it does not reliably trigger the
 * numeric keypad. Six boxes make the length obvious at a glance, and the
 * one-character-per-box rhythm is what every OTP screen has trained people to
 * expect.
 *
 * They behave as ONE control, which is the part that usually goes wrong:
 * pasting a code fills all six, Backspace on an empty box steps back, and the
 * arrow keys move between them. Anything less and the "helpful" layout is
 * slower than a plain field.
 *
 * ── THE BOXES ARE SIZED FOR A 390px PHONE, NOT FOR A MONITOR ──────────────
 *
 * Six `size-12` boxes with `gap-2` need 328px of room; inside the sign-in
 * card on a 390px viewport there are 318px, so they relied on flex-shrink to
 * squeeze — which produces six slightly-wrong rectangles and an off-grid
 * rhythm. They are `size-11` (the 44px touch floor) with `gap-1.5` on a phone
 * and grow to `size-12` at sm, so the row FITS rather than compresses.
 *
 * `rounded-xl`, not `rounded-full`: a fully-rounded 44px square is a circle,
 * and a circle is not what a digit sits in. This is the one control in the
 * area that deliberately does not take the pill shape.
 */

const LENGTH = 6;

export function VerifyEmailStep({
  email,
  onVerified,
  onUseAnotherEmail,
  className,
}: {
  email: string;
  onVerified: (user: User) => void;
  onUseAnotherEmail?: () => void;
  className?: string;
}) {
  const { verifyEmail, resendVerification } = useAuth();
  const [digits, setDigits] = React.useState<string[]>(() => Array(LENGTH).fill(''));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [cooldown, setCooldown] = React.useState(0);
  const inputs = React.useRef<Array<HTMLInputElement | null>>([]);

  const code = digits.join('');

  // The resend countdown. The backend enforces the cooldown regardless; this
  // exists so the button does not invite a press that will only be refused.
  React.useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  React.useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  const report = (thrown: unknown) => {
    if (isApiError(thrown)) {
      setError(thrown.message);
      const seconds = Number(thrown.details?.seconds_remaining ?? 0);
      if (seconds > 0) setCooldown(seconds);
      return;
    }
    setError('Something went wrong. Check your connection and try again.');
  };

  const submit = React.useCallback(
    async (value: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        onVerified(await verifyEmail(email, value));
      } catch (thrown) {
        report(thrown);
        // Clear on failure so the next attempt starts from an empty control
        // rather than requiring six backspaces first.
        setDigits(Array(LENGTH).fill(''));
        inputs.current[0]?.focus();
      } finally {
        setBusy(false);
      }
    },
    [email, onVerified, verifyEmail],
  );

  const write = (index: number, raw: string) => {
    const typed = raw.replace(/\D/g, '');
    if (!typed) return;

    setDigits((current) => {
      const next = [...current];
      // A PASTE lands in one box but fills the rest — the single most common
      // way people enter a code they were emailed.
      for (let offset = 0; offset < typed.length && index + offset < LENGTH; offset += 1) {
        next[index + offset] = typed[offset];
      }
      const filled = next.join('');
      if (filled.length === LENGTH && !filled.includes('')) {
        // Auto-submit on the last digit. Asking for a button press after the
        // code is complete is a step with no decision in it.
        void submit(filled);
      }
      return next;
    });

    const landed = Math.min(index + typed.length, LENGTH - 1);
    inputs.current[landed]?.focus();
  };

  const onKeyDown = (index: number) => (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      setDigits((current) => {
        const next = [...current];
        if (next[index]) {
          next[index] = '';
        } else if (index > 0) {
          next[index - 1] = '';
          inputs.current[index - 1]?.focus();
        }
        return next;
      });
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) inputs.current[index - 1]?.focus();
    if (event.key === 'ArrowRight' && index < LENGTH - 1) inputs.current[index + 1]?.focus();
  };

  const resend = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await resendVerification(email);
      setNotice(`A new code is on its way to ${email}.`);
      setCooldown(60);
      setDigits(Array(LENGTH).fill(''));
      inputs.current[0]?.focus();
    } catch (thrown) {
      report(thrown);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn('flex flex-col gap-block', className)}>
      <div className="flex flex-col gap-stack text-center">
        <span
          className="mx-auto inline-flex size-14 items-center justify-center rounded-full bg-nav-active text-nav-active-foreground"
          aria-hidden
        >
          <MailCheck className="size-6" />
        </span>
        <h1 className="text-h3">Check your email</h1>
        <p className="text-body-sm text-muted-foreground">
          We sent a 6-digit code to <span className="font-semibold text-foreground">{email}</span>.
        </p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (code.length === LENGTH) void submit(code);
        }}
        className="flex flex-col gap-block"
      >
        {/* One labelled GROUP rather than six unlabelled boxes: a screen reader
            announces the purpose once, instead of "edit text" six times. */}
        <div
          role="group"
          aria-label="Verification code"
          aria-describedby={error ? 'verify-error' : undefined}
          className="flex justify-center gap-1.5 sm:gap-2"
        >
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={(element) => {
                inputs.current[index] = element;
              }}
              value={digit}
              onChange={(event) => write(index, event.target.value)}
              onKeyDown={onKeyDown(index)}
              onFocus={(event) => event.target.select()}
              // `inputMode` is what raises the numeric keypad on mobile;
              // `type=number` would do that too but brings spinners and
              // accepts `e`, `+` and `-`.
              inputMode="numeric"
              autoComplete={index === 0 ? 'one-time-code' : 'off'}
              maxLength={LENGTH}
              disabled={busy}
              aria-label={`Digit ${index + 1} of ${LENGTH}`}
              aria-invalid={Boolean(error)}
              className={cn(
                'size-11 rounded-xl border bg-surface text-center text-h4 tabular-nums shadow-sm transition duration-fast sm:size-12',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                error ? 'border-destructive' : 'border-input',
              )}
            />
          ))}
        </div>

        {/* `role=alert` so the failure is announced, not just recoloured. */}
        {error ? (
          <p id="verify-error" role="alert" className="text-center text-body-sm text-destructive">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-center text-body-sm text-success">
            {notice}
          </p>
        ) : null}

        {/* `size="lg"` to match the panel's submit button. This step REPLACES
            that form inside the same card, so a primary action that changed
            height between the two states would make the card twitch on a
            transition the user did not ask for. */}
        <Button type="submit" size="lg" disabled={busy || code.length < LENGTH} className="w-full">
          {busy ? 'Verifying…' : 'Verify and continue'}
        </Button>
      </form>

      {/* Both are text links, not pills: the page already has one filled
          button, and a second capsule here would offer three equal-looking
          ways forward from a step that has exactly one. `min-h-control` keeps
          them thumb-sized without giving them a surface. */}
      <div className="flex flex-col items-center gap-stack text-body-sm">
        <button
          type="button"
          onClick={() => void resend()}
          disabled={busy || cooldown > 0}
          className="inline-flex min-h-control items-center rounded-full px-3 text-primary underline-offset-4 transition-colors hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Send a new code'}
        </button>
        {onUseAnotherEmail ? (
          <button
            type="button"
            onClick={onUseAnotherEmail}
            className="inline-flex min-h-control items-center rounded-full px-3 text-muted-foreground underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Use a different email
          </button>
        ) : null}
      </div>
    </div>
  );
}
