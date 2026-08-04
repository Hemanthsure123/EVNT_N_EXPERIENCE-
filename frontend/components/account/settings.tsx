'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  BellRing,
  Check,
  ChevronRight,
  LogOut,
  Monitor,
  Moon,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-provider';
import { useTheme, type Theme } from '@/lib/theme/theme-provider';
import { usePush } from '@/lib/push/use-push';
import { useCookieConsent, type ConsentPreference } from '@/lib/consent/use-cookie-consent';
import { GoogleCalendarCard } from '@/components/calendar/google-calendar-card';
import { AvatarUpload } from '@/components/account/avatar-upload';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { SettingsCard, SettingsNote, SettingsRow, SettingsValue } from './settings-primitives';
import {
  SETTINGS_PATH,
  SETTINGS_SECTIONS,
  contentSectionFor,
  findSection,
  resolveSection,
  sectionHref,
  type SettingsSectionId,
} from './settings-sections';

/**
 * Account settings — five sections behind a rail, not one long scroll.
 *
 * ── THE AUDIT THIS SCREEN IS BUILT FROM ───────────────────────────────────
 *
 * Every row below is backed by something the platform actually maintains. The
 * audit, because it is the whole design and not a footnote:
 *
 *   REAL, and adjustable
 *     · theme            `lib/theme/theme-provider` → `ee-theme` in this browser
 *     · profile picture  `POST`/`DELETE /auth/me/avatar` (`lib/api/profile`)
 *     · push reminders   a subscription row on the account (`lib/push/use-push`);
 *                        `on` is reached only once the SERVER stored it
 *     · cookie choice    the same `ee-cookie-consent` value the banner writes
 *     · Google Calendar  a real OAuth grant, and the card renders NOTHING where
 *                        the deployment has no Google credentials
 *     · sign out         `POST /auth/logout`
 *
 *   REAL, and read-only — `UserSerializer` maintains these columns, and
 *   `apps/accounts` exposes no write for any of them
 *     · full_name · email · email_verified · date_joined
 *
 *   NOT REAL, and therefore NOT A CONTROL ANYWHERE ON THIS PAGE
 *     · notification preferences / opt-out. The repo's CLAUDE.md lists these as
 *       deliberately future: `notifications` sends to every ticket holder and
 *       there is no preference model to read. A switch here would flip, look
 *       saved, and change nothing — which is worse than its absence, because
 *       somebody would then stop expecting the email. So Notifications states
 *       what is always on, in a sentence, with no toggle beside it.
 *     · password change · session list · 2FA · account deletion · connected
 *       accounts · phone. Named in the Account section with what each needs.
 *
 * A greyed-out control reads as "coming soon, keep checking". A sentence naming
 * the missing endpoint reads as a decision somebody made. Design system §13.6
 * and §12.3.
 *
 * ── SECTION STATE IS IN THE URL ───────────────────────────────────────────
 *
 * `?section=` (see `settings-sections.ts` for why a query param and not a nested
 * route). §11.19: a settings link is then shareable, survives reload, and Back
 * steps through sections instead of leaving the page.
 *
 * ── TWO LAYOUTS, ONE URL, NO JAVASCRIPT MEASURING THE VIEWPORT ────────────
 *
 * At `lg` a rail of five destinations sits beside one section. Below it — where
 * a second sidebar next to the account shell's own rail would be two nested
 * cramped columns — the bare URL shows an INDEX of section cards and choosing one
 * drills in, with a back link. That is why `resolveSection` distinguishes "no
 * section chosen" (`null`) from the default: the same URL is an index on a phone
 * and a rail-plus-default on a desktop, decided by CSS rather than by measuring,
 * so it is right on the first paint and there is nothing to hydrate.
 *
 * ── NO PRIMARY ACTION, BECAUSE THERE IS NOTHING TO SUBMIT ─────────────────
 *
 * Every control here writes on press, so this screen carries no near-black
 * `--cta` pill at all (§2.3 asks for one primary action per screen — and giving
 * it to sign-out would make LEAVING the loudest thing on a settings page).
 * Selected state everywhere is the warm `bg-nav-active` pill, the platform's one
 * "you are here" fill, so a rail and a segmented control agree.
 */

export function AccountSettings() {
  const params = useSearchParams();
  const { user } = useAuth();

  const query = { section: params?.get('section'), calendar: params?.get('calendar') };
  // `chosen` is null when the URL names nothing — which is what makes the phone
  // show the index. `active` is what the content column renders, and below `lg`
  // that column is hidden until something IS chosen, so its default only ever
  // surfaces beside the rail.
  const chosen = resolveSection(query);
  const active = contentSectionFor(query);

  return (
    <div className="flex flex-col gap-block lg:gap-block-lg">
      <header className="flex flex-col gap-stack">
        <h1 className="text-h3 md:text-h2">Settings</h1>
        <p className="text-body text-muted-foreground">
          Signed in as{' '}
          <span className="font-medium text-foreground [overflow-wrap:anywhere]">
            {user?.email}
          </span>
          .
        </p>
      </header>

      <div className="grid gap-block lg:grid-cols-[11rem_minmax(0,1fr)] lg:items-start lg:gap-block-lg">
        <SectionRail active={active} />

        {/* The index, and ONLY where there is no rail. A grid of two at `sm`
            because five one-line cards in a single column on a tablet is a
            column of stripes with the whole right half empty. */}
        {chosen === null ? <SectionIndex /> : null}

        <div
          className={cn('min-w-0 flex-col gap-block', chosen === null ? 'hidden lg:flex' : 'flex')}
        >
          {chosen !== null ? (
            <Link
              href={SETTINGS_PATH}
              className="inline-flex min-h-control w-fit items-center gap-1.5 text-label text-muted-foreground transition-colors duration-fast hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none lg:hidden"
            >
              <ArrowLeft className="size-4" aria-hidden />
              All settings
            </Link>
          ) : null}

          <SectionBody id={active} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ the rail */

function SectionRail({ active }: { active: SettingsSectionId }) {
  return (
    // Hidden below `lg` rather than turned into a horizontal scroller: the
    // account shell already puts one chip strip at the top of this page, and a
    // second one under it is two rows of tabs with no way to tell which level
    // you are moving within.
    <nav aria-label="Settings sections" className="hidden min-w-0 lg:block">
      <ul className="flex flex-col gap-1">
        {SETTINGS_SECTIONS.map((section) => {
          const current = section.id === active;
          return (
            <li key={section.id}>
              <Link
                href={sectionHref(section.id)}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex min-h-control items-center gap-2.5 rounded-xl px-3 py-2 transition-colors duration-fast motion-reduce:transition-none',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  current
                    ? 'bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <section.icon className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 truncate text-label">{section.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SectionIndex() {
  return (
    <nav aria-label="Settings sections" className="min-w-0 lg:hidden">
      <ul className="grid gap-stack sm:grid-cols-2">
        {SETTINGS_SECTIONS.map((section) => (
          <li key={section.id}>
            <Link
              href={sectionHref(section.id)}
              className="flex h-full min-h-control items-center gap-3 rounded-xl border border-border bg-surface p-card shadow-sm transition-shadow duration-fast hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
            >
              <span
                aria-hidden
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground"
              >
                <section.icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body-sm font-semibold text-foreground">
                  {section.label}
                </span>
                <span className="block text-caption text-muted-foreground">
                  {section.description}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SectionBody({ id }: { id: SettingsSectionId }) {
  switch (id) {
    case 'appearance':
      return <AppearanceSection />;
    case 'notifications':
      return <NotificationsSection />;
    case 'privacy':
      return <PrivacySection />;
    case 'account':
      return <AccountSection />;
    case 'profile':
    default:
      return <ProfileSection />;
  }
}

/* --------------------------------------------------------- a shared control */

/**
 * The one segmented control on this page, used by both the theme choice and the
 * cookie choice.
 *
 * The track is `bg-sunken` so unselected segments read as recessed and the
 * selected one as lifted — the only elevation trick available on a pure-white
 * canvas. `role="radiogroup"` rather than a `<select>` because there are two or
 * three options and all of them fit: a menu that has to be opened to see three
 * words is a click spent on nothing.
 */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string; icon?: LucideIcon }[];
  /** `null` renders every segment unselected — a genuine "not answered yet". */
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex max-w-full flex-wrap gap-1 rounded-full border border-border bg-sunken p-1"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-control items-center gap-2 rounded-full px-4 text-label transition-colors duration-fast motion-reduce:transition-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              selected
                ? 'bg-nav-active text-nav-active-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {option.icon ? <option.icon className="size-4" aria-hidden /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------- 1 · profile */

function ProfileSection() {
  const section = findSection('profile');
  const { user } = useAuth();

  // `email_verified` is a real column, and it is the ONLY verification claim
  // this page makes. Registration issues no session until the address is
  // proven, so a signed-in account is normally verified — printing the column
  // rather than assuming it is what keeps that true if it ever is not.
  const verified = Boolean(user?.email_verified);

  return (
    <>
      <SettingsCard id="profile" title={section.label} description={section.description}>
        <SettingsRow label="Name" hint="Shown on your bookings and beside your picture.">
          <SettingsValue>{user?.full_name || 'Not set'}</SettingsValue>
        </SettingsRow>

        <SettingsRow
          label="Email address"
          hint={
            verified
              ? 'Confirmed with a code when you signed up. Tickets go here.'
              : 'Not confirmed yet. Tickets are still sent here.'
          }
        >
          <SettingsValue>{user?.email}</SettingsValue>
          <Badge variant={verified ? 'success' : 'warning'}>
            {verified ? (
              <>
                <Check className="size-3.5" aria-hidden />
                Verified
              </>
            ) : (
              'Not verified'
            )}
          </Badge>
        </SettingsRow>

        <SettingsRow label="Member since" hint="The day this account was created.">
          <SettingsValue className="tabular-nums">
            {user?.date_joined
              ? new Date(user.date_joined).toLocaleDateString('en-IN', {
                  month: 'long',
                  year: 'numeric',
                })
              : '—'}
          </SettingsValue>
        </SettingsRow>

        <SettingsNote>
          Your name and email are shown, not edited: <code>apps/accounts</code> exposes register,
          login, refresh, logout and me — there is no <code>PATCH /auth/me</code> to write either
          one, and no phone or city column to fill in. A disabled input holding your real address
          would read as &ldquo;editing is temporarily broken&rdquo;; plain text reads as what it is.
          BACKLOG item 18 names the endpoint.
        </SettingsNote>
      </SettingsCard>

      {/* Below the facts, because it is the one thing in this section that
          writes: both avatar endpoints answer with the whole profile, so the
          picture changing here is proof it changed on the account. */}
      <AvatarUpload />
    </>
  );
}

/* ------------------------------------------------------------ 2 · appearance */

const THEMES: readonly { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

function AppearanceSection() {
  const section = findSection('appearance');
  const { theme, setTheme } = useTheme();

  return (
    <SettingsCard id="appearance" title={section.label} description={section.description}>
      <SettingsRow label="Theme" hint="Writes as you press it — there is nothing to save." stacked>
        <Segmented<Theme> label="Colour theme" options={THEMES} value={theme} onChange={setTheme} />
      </SettingsRow>

      <SettingsRow
        label="Reduced motion"
        hint="Transitions and animations follow your device's accessibility setting. There is no switch here because overriding your own system preference from one website is not ours to do."
      >
        <SettingsValue className="text-muted-foreground">Follows your device</SettingsValue>
      </SettingsRow>

      <SettingsNote>
        The theme is stored in THIS browser, not on your account — there is no column for it, so a
        new device starts on System and follows whatever it prefers. Both themes are fully
        supported; neither is an afterthought.
      </SettingsNote>
    </SettingsCard>
  );
}

/* --------------------------------------------------------- 3 · notifications */

function NotificationsSection() {
  const section = findSection('notifications');

  return (
    <SettingsCard id="notifications" title={section.label} description={section.description}>
      <PushRow />

      <SettingsRow
        label="Ticket emails and SMS"
        hint="A booking confirmation with your QR code, a refund confirmation, and one reminder before an event you hold tickets for. Nothing else — there is no marketing list."
      >
        <SettingsValue className="text-muted-foreground">Always sent</SettingsValue>
      </SettingsRow>

      <SettingsNote>
        There is deliberately no switch beside that row. The account record holds no notification
        preference, so a toggle here would move, look saved, and change nothing that gets sent — and
        somebody who trusted it would stop expecting the email that carries their ticket.
        Per-message opt-out needs a preference model on the account (BACKLOG); until it exists this
        page says what happens instead of pretending to control it.
      </SettingsNote>
    </SettingsCard>
  );
}

/**
 * Push reminders for THIS device.
 *
 * Eight states, and each gets its own sentence — the reason `usePush` returns a
 * union rather than a boolean. `on` is reached only after the server stored the
 * subscription, never from the browser permission alone; the states where push
 * cannot work say WHICH of the five reasons it is, because a single greyed-out
 * button would be a shrug at all of them.
 */
function PushRow() {
  const { state, busy, error, enable, disable } = usePush();

  const hint: Record<typeof state, string> = {
    loading: 'Checking what this browser and this deployment can do.',
    unavailable:
      'This deployment has no push keys configured, so nothing can be delivered to a browser. There is nothing to switch on rather than a control that would fail.',
    unsupported: 'This browser has no push support, so there is nothing to switch on.',
    insecure: 'Push notifications need a secure (https) connection, and this page is not on one.',
    'signed-out': 'A subscription belongs to an account, so this needs you signed in.',
    blocked:
      'Notifications are blocked for this site in your browser settings. A site cannot ask twice — allowing them there is the only way back.',
    off: 'One notification the day before an event you hold tickets for. No marketing, and it applies to this browser only.',
    on: 'This browser is subscribed. You will get one notification the day before an event you hold tickets for.',
  };

  return (
    <SettingsRow label="Event reminders on this device" hint={hint[state]}>
      {state === 'on' ? (
        <>
          <Badge variant="success">
            <Check className="size-3.5" aria-hidden />
            On
          </Badge>
          {/* Default size, not `sm`: 44px is the touch floor (§11.1/§14.4) and
              these rows are the whole reason somebody opened this page on a
              phone. */}
          <Button type="button" variant="ghost" onClick={() => void disable()} loading={busy}>
            Turn off
          </Button>
        </>
      ) : state === 'off' ? (
        <Button
          type="button"
          variant="outline"
          leftIcon={<BellRing className="size-4" aria-hidden />}
          onClick={() => void enable()}
          loading={busy}
        >
          Turn on
        </Button>
      ) : (
        <SettingsValue className="text-muted-foreground">
          {state === 'loading'
            ? 'Checking…'
            : state === 'blocked'
              ? 'Blocked in this browser'
              : 'Not available here'}
        </SettingsValue>
      )}

      {error ? (
        <p role="alert" className="w-full text-caption text-destructive sm:text-right">
          {error}
        </p>
      ) : null}
    </SettingsRow>
  );
}

/* -------------------------------------------------------------- 4 · privacy */

const CONSENT_OPTIONS: readonly { value: ConsentPreference; label: string }[] = [
  { value: 'essential', label: 'Essential only' },
  { value: 'all', label: 'Accept all' },
];

/**
 * What this browser keeps. Enumerated rather than summarised, because "we store
 * some preferences locally" is the sentence a privacy page uses when it does not
 * want to be checked.
 */
const DEVICE_STORAGE = [
  'Your theme choice',
  'The city you picked',
  'Events you saved while browsing',
  'Whether results show as a grid or a list',
  'Your answer to the cookie banner',
  'Your sign-in tokens, until you sign out',
];

function PrivacySection() {
  const section = findSection('privacy');
  const { preference, ready, accept } = useCookieConsent();

  return (
    <SettingsCard id="privacy" title={section.label} description={section.description}>
      <SettingsRow
        label="Analytics and marketing storage"
        hint="Your answer to the cookie banner, changeable here. It is honoured by being obeyed in advance: this app stores nothing for analytics or marketing today, and the flag is what an analytics module would have to read on the day there is one."
        stacked
      >
        <Segmented<ConsentPreference>
          label="Cookie and storage choice"
          options={CONSENT_OPTIONS}
          // Unanswered until storage has been read, and while it is being read —
          // a default of "Accept all" on the first frame would show a consent
          // nobody gave.
          value={ready ? preference : null}
          onChange={accept}
        />
      </SettingsRow>

      <SettingsRow
        label="Saved events"
        hint="Kept in this browser as you browse, and mirrored onto your account while you are signed in, so they follow you to another device."
      >
        <Link
          href="/account/saved"
          className="inline-flex min-h-control items-center gap-1.5 text-label text-foreground underline underline-offset-2 transition-colors duration-fast hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
        >
          View saved events
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      </SettingsRow>

      <SettingsRow
        label="Kept in this browser"
        hint="All first-party, all in this browser's own storage, and all removed by clearing this site's data in your browser settings."
        stacked
      >
        <ul className="flex list-disc flex-col gap-1 pl-4 text-caption text-muted-foreground">
          {DEVICE_STORAGE.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </SettingsRow>

      <SettingsNote>
        Downloading a copy of your data, and deleting the account, are not offered here because
        neither exists: an export needs a job that assembles bookings, tickets and payments, and a
        deletion needs a retention policy first — a booking, a ticket and a settlement are financial
        records that other rows point at, so &ldquo;delete everything&rdquo; is a policy decision
        before it is a button.
      </SettingsNote>
    </SettingsCard>
  );
}

/* -------------------------------------------------------------- 5 · account */

/**
 * The security items are the ones worth building first, and they are ordered
 * that way: somebody who cannot change their password after a breach has no
 * recourse at all.
 */
const NOT_BUILT: { label: string; needs: string }[] = [
  { label: 'Change password', needs: 'POST /auth/password' },
  { label: 'Update email or phone', needs: 'PATCH /auth/me (BACKLOG 18)' },
  { label: 'Active sessions, and sign out everywhere', needs: 'a session registry' },
  { label: 'Two-factor authentication', needs: 'a TOTP enrolment flow' },
  { label: 'Delete account', needs: 'a deletion flow with a retention policy' },
  { label: 'Google and Apple sign-in', needs: 'the OAuth endpoints in BACKLOG 19' },
];

function AccountSection() {
  const section = findSection('account');
  const { signOut } = useAuth();
  const router = useRouter();

  return (
    <>
      <SettingsCard id="account" title={section.label} description={section.description}>
        <SettingsRow
          label="Sign out"
          hint="Signs out this browser. Signing out everywhere needs a session registry, which does not exist yet."
        >
          {/* Deliberately the QUIET pill. Leaving is not this page's primary
              action, and a near-black "Sign out" would be the loudest thing on
              a screen whose job is preferences. */}
          <Button
            type="button"
            variant="outline"
            leftIcon={<LogOut className="size-4" aria-hidden />}
            onClick={() => void signOut().then(() => router.push('/'))}
          >
            Sign out
          </Button>
        </SettingsRow>

        <SettingsRow
          label="Not available yet"
          hint="Named with what each one needs, rather than shown as disabled buttons — a greyed-out control reads as “coming soon”, and none of these is one deploy away."
          stacked
        >
          <ul className="flex flex-col gap-1.5">
            {NOT_BUILT.map((item) => (
              <li
                key={item.label}
                className="flex flex-wrap items-baseline gap-x-2 text-caption text-muted-foreground"
              >
                <span className="text-body-sm font-medium text-foreground">{item.label}</span>
                <span>— needs {item.needs}</span>
              </li>
            ))}
          </ul>
        </SettingsRow>
      </SettingsCard>

      {/* AFTER the card, for two reasons. Its heading is an `h3`, so putting it
          above the section's `h2` would skip a level (an axe `heading-order`
          violation this page had while the card sat under the page title). And
          it renders NOTHING unless the deployment has Google credentials — it
          asks the server first rather than offering a button that would 503 —
          so a card that may be absent must not be the section's first thing. */}
      <React.Suspense fallback={null}>
        <GoogleCalendarCard />
      </React.Suspense>
    </>
  );
}
