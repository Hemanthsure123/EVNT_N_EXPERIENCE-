'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-provider';
import { useTheme } from '@/lib/theme/theme-provider';
import { GoogleCalendarCard } from '@/components/calendar/google-calendar-card';
import { Panel } from '@/components/organizer/primitives';
import { cn } from '@/lib/utils/cn';

/**
 * Account settings.
 *
 * ── WHAT IS REAL HERE ─────────────────────────────────────────────────────
 *
 * Appearance (a genuine, persisted preference) and sign-out. That is the
 * honest extent of what `apps/accounts` supports today: it exposes register,
 * login, refresh, logout and me — no PATCH, no password change, no email or
 * phone update, no session list, no delete.
 *
 * ── WHY THE REST IS A LIST, NOT A SET OF DISABLED CONTROLS ────────────────
 *
 * A greyed-out "Change password" button reads as "coming soon, keep checking".
 * A sentence naming the missing endpoint reads as a decision somebody made,
 * and is honest about the fact that nothing here is one deploy away. Design
 * system §13.6 and §12.3.
 *
 * The security items are the ones worth building first, and they are ordered
 * that way: a person who cannot change their password after a breach has no
 * recourse at all.
 *
 * ── NO PRIMARY ACTION, BECAUSE THERE IS NOTHING TO SUBMIT ─────────────────
 *
 * The appearance control writes on press and sign-out is deliberately quiet —
 * so this screen carries no near-black `--cta` pill at all. Giving sign-out the
 * primary shape would make LEAVING the loudest thing on the settings page. The
 * selected theme wears the warm `--nav-active` pill, the same "current state"
 * token the account rail uses, so a segmented control and a nav rail say
 * "selected" the same way.
 */

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const;

const NOT_BUILT: { group: string; items: { label: string; needs: string }[] }[] = [
  {
    group: 'Security',
    items: [
      { label: 'Change password', needs: 'POST /auth/password' },
      { label: 'Update email or phone', needs: 'PATCH /auth/me (BACKLOG 18)' },
      { label: 'Active sessions and sign out everywhere', needs: 'a session registry' },
      { label: 'Two-factor authentication', needs: 'a TOTP enrolment flow' },
      { label: 'Delete account', needs: 'a deletion flow with a retention policy' },
    ],
  },
  {
    group: 'Notifications',
    items: [
      {
        label: 'Email, SMS and marketing preferences',
        needs: 'a preference model — `notifications` sends to everyone today',
      },
    ],
  },
  {
    group: 'Connected accounts',
    items: [
      { label: 'Google and Apple', needs: 'the OAuth endpoints in BACKLOG 19' },
      { label: 'Social profiles', needs: 'columns on the organization, not the user' },
    ],
  },
];

export function AccountSettings() {
  const { user, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const router = useRouter();

  return (
    <div className="flex flex-col gap-block lg:gap-block-lg">
      <header className="flex flex-col gap-stack">
        <h1 className="text-h3 md:text-h2">Settings</h1>
        <p className="text-body text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{user?.email}</span>.
        </p>
      </header>

      {/* Renders nothing unless the deployment has OAuth credentials — it
          asks the server first rather than offering a button that would 503. */}
      <React.Suspense fallback={null}>
        <GoogleCalendarCard />
      </React.Suspense>

      <Panel title="Appearance" subtitle="Applies to this browser" className="shadow-sm">
        <div className="p-card">
          {/* The track is `bg-sunken` so the unselected segments read as
              recessed and the selected one as lifted — the only elevation
              trick available on a pure-white canvas. */}
          <div
            role="radiogroup"
            aria-label="Colour theme"
            className="inline-flex max-w-full flex-wrap gap-1 rounded-full border border-border bg-sunken p-1"
          >
            {THEMES.map((entry) => (
              <button
                key={entry.value}
                type="button"
                role="radio"
                aria-checked={theme === entry.value}
                onClick={() => setTheme(entry.value)}
                className={cn(
                  'inline-flex h-control items-center gap-2 rounded-full px-4 text-label transition-colors duration-fast',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  theme === entry.value
                    ? 'bg-nav-active text-nav-active-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <entry.icon className="size-4" aria-hidden />
                {entry.label}
              </button>
            ))}
          </div>
          <p className="mt-stack text-caption text-muted-foreground">
            System follows your device. Both themes are fully supported — neither is an
            afterthought.
          </p>
        </div>
      </Panel>

      <Panel title="Session" className="shadow-sm">
        <div className="flex flex-wrap items-center gap-stack-lg p-card">
          {/* Deliberately the QUIET pill. Leaving is not this page's primary
              action, and a near-black "Sign out" would be the loudest thing on
              a screen whose job is preferences. */}
          <button
            type="button"
            onClick={() => void signOut().then(() => router.push('/'))}
            className="inline-flex h-control items-center gap-2 rounded-full border border-border bg-surface px-pill text-label text-foreground transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <LogOut className="size-4" aria-hidden />
            Sign out
          </button>
          <p className="min-w-0 flex-1 text-caption text-muted-foreground">
            Signs out this browser. Signing out everywhere needs a session registry, which does not
            exist yet.
          </p>
        </div>
      </Panel>

      <Panel
        title="Not available yet"
        subtitle="Named honestly, with what each one needs"
        className="shadow-sm"
      >
        <div className="flex flex-col gap-block p-card">
          {NOT_BUILT.map((section) => (
            <section key={section.group} className="flex flex-col gap-stack">
              <h3 className="text-label uppercase tracking-wide text-foreground-subtle">
                {section.group}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {section.items.map((item) => (
                  <li
                    key={item.label}
                    className="flex flex-wrap items-baseline gap-x-2 text-caption text-muted-foreground"
                  >
                    <span className="text-body-sm font-medium text-foreground">{item.label}</span>
                    <span>— needs {item.needs}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="rounded-lg bg-sunken p-card text-caption text-muted-foreground">
            These are listed rather than shown as disabled controls: a greyed-out button reads as
            &ldquo;coming soon&rdquo;, and none of these is one deploy away.
          </p>
        </div>
      </Panel>
    </div>
  );
}
