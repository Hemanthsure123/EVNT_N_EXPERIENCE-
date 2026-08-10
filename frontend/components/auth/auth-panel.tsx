'use client';

import * as React from 'react';
import { ArrowLeft, Eye, EyeOff, Info, Mail, Phone, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, isApiError } from '@/lib/api/errors';
import { AccountSuspended } from '@/components/auth/account-suspended';
import {
  googleSignInAvailable,
  type GoogleSignInAvailability,
  ProviderNotConfiguredError,
  requestPhoneOtp,
  resendVerification,
  startOAuth,
  verifyPhoneOtp,
} from '@/lib/api/auth';
import { VerifyEmailStep } from './verify-email-step';
import { useAuth } from '@/lib/auth/auth-provider';
import type { User } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';
import { GoogleMark } from './provider-marks';

/**
 * The one sign-in surface, used by `/sign-in` AND the booking funnel's step 2.
 *
 * Two copies of an auth form is how the two drift: one grows a password toggle,
 * the other grows phone sign-in, and eventually they validate differently. The
 * only thing either caller varies is the framing — an optional heading, and
 * where to go afterwards. The form itself is identical in both places, which is
 * also why the standalone page's decoration lives on the PAGE
 * (`sign-in-art.tsx`) and not in here.
 *
 * WHAT IS LIVE AND WHAT IS A SEAM. Email and password talk to `apps/accounts`
 * for real, and so does Google — `googleSignInAvailable()` asks the BACKEND
 * whether this deployment has credentials, because they live only there.
 * Phone/OTP is still a seam: it fails immediately with
 * `ProviderNotConfiguredError`, which renders as a plain sentence naming the
 * provider. It never spins, and it never reports a sign-in that didn't happen —
 * an auth control that appears to work is the worst thing on this page to fake,
 * because a ticket and a payment are attributed to whoever it claims you are.
 *
 * APPLE IS GONE. It was a third pill on the busiest part of the page whose only
 * behaviour was to say it wasn't connected. Google earns its place because it
 * genuinely works where configured; phone earns its place because the OTP
 * delivery half already exists in `notifications` and the endpoints are
 * specified. A provider that is neither wired nor planned is just a control
 * that teaches people the page is broken.
 *
 * ── THE ORDER, WHICH IS THE WHOLE REDESIGN ───────────────────────────────
 *
 * It used to be: mode tabs, provider buttons, an "or" rule, method tabs, then
 * finally the form. Five groups of chrome before the first field, and — worse —
 * `google` starts UNDEFINED and resolves after a network round trip, so
 * the entire form JUMPED DOWN a moment after paint, right as somebody was
 * reaching for the email box.
 *
 * Now the form leads and the alternative follows it:
 *
 *   heading -> mode -> method -> fields -> THE PRIMARY ACTION -> or -> Google
 *
 * The one filled control is the near-black `--cta` pill at the end of the form,
 * so there is exactly one obvious thing to press. The mode and method switches
 * are STATE, so they wear the warm `--nav-active` pill — the same "you are
 * here" token the site nav uses — and Google is an outline pill: same shape
 * language, unmistakably not the primary action. And because the provider block
 * now sits BELOW the submit button, the late-arriving Google button can no
 * longer shift anything anybody is aiming at.
 *
 * ── NO "FORGOT PASSWORD" LINK ────────────────────────────────────────────
 *
 * `apps/accounts` has no reset endpoint (see its urls.py: register, login,
 * verify-email, resend, refresh, logout, me, and the Google trio). A link to a
 * recovery flow that does not exist is worse than its absence on the one screen
 * where somebody is already stuck.
 */

type Mode = 'signin' | 'signup';
type Method = 'email' | 'phone';

const METHODS = [
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'phone', label: 'Phone', icon: Phone },
] as const satisfies ReadonlyArray<{ value: Method; label: string; icon: LucideIcon }>;

/** The subheading is MODE-AWARE. It used to be the caller's string in both
 *  modes, so switching to Create account left "Sign in to see your tickets"
 *  sitting under a registration form. */
const SIGNUP_SUBHEADING = 'It takes a minute. Your tickets, orders and refunds all live here.';

export function AuthPanel({
  onAuthenticated,
  heading,
  subheading,
  /** Where a successful OAuth round trip should return to. */
  next = '/',
  className,
}: {
  onAuthenticated: (user: User) => void;
  heading?: string;
  subheading?: string;
  next?: string;
  className?: string;
}) {
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = React.useState<Mode>('signin');
  // Set once registration succeeds. Registration issues NO session, so this is
  // not an optional interstitial — it is the only way forward, which is why it
  // REPLACES the form rather than appearing beside it.
  const [awaitingVerification, setAwaitingVerification] = React.useState<string | null>(null);
  const [suspended, setSuspended] = React.useState<string | null>(null);
  // Asked of the BACKEND, because the Google credentials live only there.
  // Undefined while unknown, so the button is not flashed and then withdrawn.
  const [google, setGoogle] = React.useState<GoogleSignInAvailability | undefined>(undefined);
  const [method, setMethod] = React.useState<Method>('email');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [fullName, setFullName] = React.useState('');
  const [reveal, setReveal] = React.useState(false);

  const [phone, setPhone] = React.useState('');
  const [code, setCode] = React.useState('');
  const [codeSent, setCodeSent] = React.useState(false);

  const reset = () => {
    setError(null);
    setNotice(null);
    // Cleared on every submit: switching between sign-in and sign-up, or
    // trying a different address, must not leave the previous account's dead
    // end on screen.
    setSuspended(null);
  };

  const handleUnverified = (thrown: unknown): boolean => {
    // `email_not_verified` is a DISTINCT code from `invalid_credentials`
    // precisely so this is possible: the password was right, the address was
    // never proven. Sending them to the verify step is more useful than an
    // error telling them something they cannot act on.
    if (isApiError(thrown) && thrown.code === 'email_not_verified') {
      setAwaitingVerification(email.trim().toLowerCase());
      void resendVerification(email.trim().toLowerCase()).catch(() => {
        // A cooldown here is fine — a code from moments ago is still valid,
        // and the step's own resend button reports the wait.
      });
      return true;
    }
    return false;
  };

  const handle = (thrown: unknown) => {
    if (handleUnverified(thrown)) return;
    // A distinct code, for the same reason `email_not_verified` is one: the
    // credential was right and there is nothing on this form that can help.
    // Rendering it as a red line under the password field would send them to
    // reset a password that was never wrong — which is precisely the loop the
    // backend stopped disguising.
    if (isApiError(thrown) && thrown.code === 'account_suspended') {
      setSuspended(email.trim().toLowerCase());
      return;
    }
    if (thrown instanceof ProviderNotConfiguredError) {
      // Not an error the user caused — say what's true and point at what works.
      // Email + password is the one method with a backend behind it today.
      setNotice(`${thrown.message} Sign in with your email and password for now.`);
      return;
    }
    setError(
      thrown instanceof ApiError
        ? thrown.message
        : 'Something went wrong. Check your connection and try again.',
    );
  };

  React.useEffect(() => {
    let cancelled = false;
    void googleSignInAvailable().then((availability) => {
      if (!cancelled) setGoogle(availability);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const submitEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    reset();
    setBusy(true);
    try {
      if (mode === 'signin') {
        onAuthenticated(await signIn(email, password));
      } else {
        await signUp(email, password, fullName);
        // NOT `onAuthenticated`: there is no session yet. Verifying is what
        // mints one.
        setAwaitingVerification(email.trim().toLowerCase());
      }
    } catch (thrown) {
      handle(thrown);
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async (event: React.FormEvent) => {
    event.preventDefault();
    reset();
    setBusy(true);
    try {
      await requestPhoneOtp(phone);
      setCodeSent(true);
    } catch (thrown) {
      handle(thrown);
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (event: React.FormEvent) => {
    event.preventDefault();
    reset();
    setBusy(true);
    try {
      const { user } = await verifyPhoneOtp(phone, code);
      onAuthenticated(user);
    } catch (thrown) {
      handle(thrown);
    } finally {
      setBusy(false);
    }
  };

  const continueWithGoogle = () => {
    reset();
    try {
      startOAuth('google', next);
    } catch (thrown) {
      handle(thrown);
    }
  };

  if (suspended) {
    return (
      <AccountSuspended
        email={suspended}
        onUseAnotherEmail={() => {
          setSuspended(null);
          setEmail('');
          setPassword('');
          reset();
        }}
        className={className}
      />
    );
  }

  if (awaitingVerification) {
    return (
      <VerifyEmailStep
        email={awaitingVerification}
        onVerified={onAuthenticated}
        onUseAnotherEmail={() => {
          setAwaitingVerification(null);
          reset();
        }}
        className={className}
      />
    );
  }

  const submitLabel = mode === 'signin' ? 'Sign in' : 'Create account';

  return (
    // `gap-stack-lg` (16px) between the panel's own parts, NOT `gap-block`
    // (24px). The page rhythm is for section-to-section on a long page; this
    // is one compact card whose whole job is to be read and filled in without
    // scrolling. At `gap-block` the header, the method tabs, the form, the
    // divider and the provider buttons were five gaps of 24px — 120px of air
    // in a card that fits on one screen only just.
    <div className={cn('flex w-full flex-col gap-stack-lg', className)}>
      {heading ? (
        <header className="flex flex-col gap-1.5">
          {/* One rung down: an auth card's title is a label for the form under
              it, not the headline of a page. `text-h2` at the top of a 480px
              column pushes the first input below the fold on a laptop. */}
          <h1 className="text-h4 sm:text-h3">
            {mode === 'signin' ? heading : 'Create your account'}
          </h1>
          {subheading ? (
            <p className="text-pretty text-body-sm text-muted-foreground">
              {mode === 'signin' ? subheading : SIGNUP_SUBHEADING}
            </p>
          ) : null}
        </header>
      ) : null}

      {/* The sliding pill is ONE element moved with a CSS transform, not a
          Framer `layoutId`. This panel now renders on the public site as well
          as in the funnel, and pulling the animation library into the site
          bundle to move a 50%-wide rectangle is not a trade worth making —
          `transition-transform` is the same motion for no bytes.

          The track is `bg-sunken` and the pill `bg-nav-active`: on a pure-white
          canvas an unfilled track is invisible, so the recess is what makes the
          pill read as sitting IN something. */}
      <div
        role="tablist"
        aria-label="Sign in or create an account"
        className="relative flex rounded-full border border-border bg-sunken p-1"
      >
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-nav-active shadow-sm',
            'transition-transform duration-base ease-out motion-reduce:transition-none',
            mode === 'signup' && 'translate-x-full',
          )}
        />
        {(['signin', 'signup'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={mode === value}
            onClick={() => {
              setMode(value);
              reset();
            }}
            className={cn(
              'relative z-10 h-control flex-1 rounded-full text-label transition-colors duration-fast',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              mode === value ? 'text-nav-active-foreground' : 'text-muted-foreground',
            )}
          >
            {value === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>

      {/* ── GOOGLE FIRST ───────────────────────────────────────────────────
          It used to sit BELOW the form, on the reasoning that a button which
          arrives asynchronously must not push the primary action out from
          under a cursor. That reasoning was about the RACE, and the race is
          still handled: this only renders once `google === 'available'`, and
          from up here what it displaces is the method switcher rather than the
          field somebody is reaching for.

          Above, because for most people it is the fastest way in — one tap and
          no password, against typing an address and waiting for a code. An
          option that replaces the whole form is not a footnote to it, and the
          rule now reads "or" leading INTO the form rather than trailing off
          the end of it. */}
      {google === 'available' ? (
        <div className="flex flex-col gap-stack">
          <ProviderButton onClick={continueWithGoogle} label="Continue with Google">
            <GoogleMark />
          </ProviderButton>
          <div className="flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            <span className="text-caption uppercase tracking-wide text-foreground-subtle">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </div>
      ) : null}

      {/* Method + form are ONE group, bound by the tighter `stack-lg` rung, so
          the switch reads as belonging to the fields under it rather than as a
          second navigation bar under the first. */}
      <div className="flex flex-col gap-stack">
        <div role="tablist" aria-label="Sign-in method" className="flex gap-2">
          {METHODS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              role="tab"
              type="button"
              aria-selected={method === value}
              onClick={() => {
                setMethod(value);
                setCodeSent(false);
                reset();
              }}
              className={cn(
                'inline-flex h-control items-center gap-2 rounded-full border px-pill text-label transition-colors duration-fast',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                method === value
                  ? 'border-transparent bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
                  : 'border-border bg-surface text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>

        {method === 'email' ? (
          <form onSubmit={submitEmail} className="flex flex-col gap-stack" noValidate>
            {mode === 'signup' ? (
              <Field label="Full name" htmlFor="auth-name">
                <Input
                  id="auth-name"
                  autoComplete="name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Asha Rao"
                />
              </Field>
            ) : null}

            <Field label="Email" htmlFor="auth-email">
              <Input
                id="auth-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </Field>

            <Field
              label="Password"
              htmlFor="auth-password"
              hint={mode === 'signup' ? 'At least 8 characters.' : undefined}
            >
              <div className="relative">
                <Input
                  id="auth-password"
                  type={reveal ? 'text' : 'password'}
                  required
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  aria-describedby={mode === 'signup' ? 'auth-password-hint' : undefined}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="pr-12"
                />
                <button
                  type="button"
                  onClick={() => setReveal((current) => !current)}
                  aria-label={reveal ? 'Hide password' : 'Show password'}
                  aria-pressed={reveal}
                  className="absolute inset-y-0 right-0 inline-flex w-control items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {reveal ? (
                    <EyeOff className="size-4" aria-hidden />
                  ) : (
                    <Eye className="size-4" aria-hidden />
                  )}
                </button>
              </div>
            </Field>

            <Messages error={error} notice={notice} />

            <Button type="submit" size="lg" loading={busy} className="mt-1 w-full">
              {submitLabel}
            </Button>
          </form>
        ) : codeSent ? (
          <form onSubmit={submitCode} className="flex flex-col gap-stack" noValidate>
            <Field label="Verification code" htmlFor="auth-code" hint={`Sent to ${phone}.`}>
              <Input
                id="auth-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                aria-describedby="auth-code-hint"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="123456"
              />
            </Field>

            <Messages error={error} notice={notice} />

            <Button type="submit" size="lg" loading={busy} className="mt-1 w-full">
              Verify and continue
            </Button>
            <button
              type="button"
              onClick={() => {
                setCodeSent(false);
                reset();
              }}
              className="inline-flex min-h-control items-center gap-1.5 self-start rounded-full pr-3 text-body-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="size-4" aria-hidden />
              Use a different number
            </button>
          </form>
        ) : (
          <form onSubmit={sendCode} className="flex flex-col gap-stack" noValidate>
            <Field
              label="Phone number"
              htmlFor="auth-phone"
              hint="Include the country code, e.g. +91 98765 43210."
            >
              <Input
                id="auth-phone"
                type="tel"
                required
                autoComplete="tel"
                aria-describedby="auth-phone-hint"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+91 98765 43210"
              />
            </Field>

            <Messages error={error} notice={notice} />

            <Button type="submit" size="lg" loading={busy} className="mt-1 w-full">
              Send code
            </Button>
          </form>
        )}
      </div>

      {/* ── UNREACHABLE IS NOT "NOT CONFIGURED" ────────────────────────────
          A deployment that genuinely has no Google credentials hides the
          button and says nothing — correct, and the case above.
          But when the config call could not COMPLETE, the missing button is a
          symptom of something that also breaks the form directly above it: if
          we cannot reach the backend, a password cannot be checked either.
          Saying so once beats letting somebody type their credentials into a
          form that will fail on submit — and beats the conclusion the silence
          invites, which is that a feature was removed. */}
      {google === 'unreachable' ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-warning-subtle bg-warning-subtle p-3 text-body-sm text-warning-subtle-foreground"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            We can&apos;t reach the sign-in service right now, so other sign-in options are hidden
            and the form above may not submit. This is on our side — please try again shortly.
          </span>
        </p>
      ) : null}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {/* The id is derived from the field's, and the input points at it with
          `aria-describedby` — a hint a screen reader never reads is decoration
          for sighted users only. */}
      {hint ? (
        <p id={`${htmlFor}-hint`} className="text-caption text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function Messages({ error, notice }: { error: string | null; notice: string | null }) {
  if (error) {
    return (
      <p
        role="alert"
        className="flex items-start gap-2.5 rounded-lg border border-destructive-subtle bg-destructive-subtle px-4 py-3 text-body-sm text-destructive-subtle-foreground"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{error}</span>
      </p>
    );
  }
  if (notice) {
    // NOT an error style: nothing has gone wrong and the user did nothing
    // wrong — a provider simply isn't connected yet.
    return (
      <p
        role="status"
        className="flex items-start gap-2.5 rounded-lg border border-border bg-sunken px-4 py-3 text-body-sm text-muted-foreground"
      >
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{notice}</span>
      </p>
    );
  }
  return null;
}

function ProviderButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-control-lg w-full items-center justify-center gap-3 rounded-full border border-border bg-surface px-pill text-label text-foreground shadow-sm',
        'transition duration-fast ease-out hover:bg-muted active:scale-[0.99]',
        'motion-reduce:transition-none motion-reduce:active:scale-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      )}
    >
      {children}
      {label}
    </button>
  );
}
