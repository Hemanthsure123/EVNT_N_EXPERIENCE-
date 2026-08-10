'use client';

import * as React from 'react';
import Link from 'next/link';
import { LifeBuoy, Mail, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SUPPORT_EMAIL, SUPPORT_PHONE } from '@/lib/brand';
import { cn } from '@/lib/utils/cn';

/**
 * The dead end, named.
 *
 * ── WHAT THIS REPLACED ────────────────────────────────────────────────────
 *
 * A suspended account used to fail with `invalid_credentials` — indis-
 * tinguishable from a typo. So the person reset their password, succeeded at
 * resetting it, was refused again, signed up afresh with the same address, was
 * told it was "already registered", and went round once more. Every screen in
 * that loop was truthful and the whole loop was useless.
 *
 * ── IT OFFERS NO RETRY ────────────────────────────────────────────────────
 *
 * There is no self-service route out of a suspension, so a "try again" button
 * would be a control whose only job is to fail. The single action here is the
 * one that can actually help — reaching a human — and it is a real `mailto:`
 * with the address prefilled, so support gets the account in the first line
 * instead of asking for it.
 *
 * ── AND IT INVENTS NO REASON ──────────────────────────────────────────────
 *
 * The API deliberately does not send one: an operator's note is written for
 * the next operator, not for the person it is about, and rendering "chargeback
 * fraud" to somebody would publish an internal judgement. So this says what
 * is true — a review is needed and a human does it.
 */

export function AccountSuspended({
  email,
  onUseAnotherEmail,
  className,
}: {
  email: string;
  onUseAnotherEmail?: () => void;
  className?: string;
}) {
  const subject = encodeURIComponent('Account review request');
  const body = encodeURIComponent(
    `Hello,\n\nMy account (${email}) has been suspended and I would like it reviewed.\n\n`,
  );

  return (
    <section
      aria-labelledby="suspended-heading"
      className={cn(
        'flex flex-col gap-5 rounded-xl border border-border bg-surface p-card shadow-md lg:p-card-lg',
        className,
      )}
    >
      <span
        // Warning, not destructive: nothing here has gone wrong for the user
        // to fix, and a red panel reads as "you broke something".
        className="inline-flex size-11 items-center justify-center rounded-full bg-warning-subtle text-warning-subtle-foreground"
        aria-hidden
      >
        <ShieldOff className="size-5" />
      </span>

      <div className="flex flex-col gap-2">
        <h2 id="suspended-heading" className="text-h4">
          This account needs an administrator
        </h2>
        <p className="text-body-sm text-muted-foreground">
          Access for <span className="font-medium text-foreground">{email}</span> has been paused
          by our team. Signing in again — or creating a new account with the same address — will
          not lift it; only a review will.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {SUPPORT_EMAIL ? (
          <Button asChild className="h-control-lg w-full rounded-full bg-cta px-pill-lg text-cta-foreground hover:bg-cta-hover">
            <a href={`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`}>
              <Mail className="size-4" aria-hidden />
              Email support
            </a>
          </Button>
        ) : (
          // The address is env-driven, and an unset one renders as a link to
          // the support page rather than a `mailto:` to nowhere — the same
          // rule the footer's social links follow.
          <Button asChild className="h-control-lg w-full rounded-full bg-cta px-pill-lg text-cta-foreground hover:bg-cta-hover">
            <Link href="/support">
              <LifeBuoy className="size-4" aria-hidden />
              Contact support
            </Link>
          </Button>
        )}

        {SUPPORT_PHONE ? (
          <p className="text-center text-caption text-muted-foreground">
            or call{' '}
            <a
              href={`tel:${SUPPORT_PHONE.replace(/\s+/g, '')}`}
              className="font-medium text-foreground underline underline-offset-2"
            >
              {SUPPORT_PHONE}
            </a>
          </p>
        ) : null}
      </div>

      {onUseAnotherEmail ? (
        <button
          type="button"
          onClick={onUseAnotherEmail}
          className="w-fit self-center rounded-full text-caption text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Use a different email
        </button>
      ) : null}
    </section>
  );
}
