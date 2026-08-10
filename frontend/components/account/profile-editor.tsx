'use client';

import * as React from 'react';
import { Check, Loader2, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DayPicker } from '@/components/ui/day-picker';
import { AvatarUpload } from '@/components/account/avatar-upload';
import { GenderField } from '@/components/account/profile-fields';
import { SceneAboutYou } from '@/components/illustrations/onboarding-scenes';
import { useAuth } from '@/lib/auth/auth-provider';
import { updateProfile } from '@/lib/api/profile';
import { errorMessage } from '@/lib/api/errors';
import {
  changedFields,
  formFromUser,
  profileCompleteness,
  validateProfile,
  type ProfileForm,
} from '@/lib/account/profile-form';
import { cn } from '@/lib/utils/cn';

/**
 * The profile — the editable half of the settings screen's first section.
 *
 * ── WHAT THIS REPLACED, AND WHY THE NOTE IT REPLACED WAS RIGHT ────────────
 *
 * This section used to render name and email as PLAIN TEXT, with a note saying
 * so: `apps/accounts` exposed no `PATCH /auth/me`, and a disabled input holding
 * somebody's real address reads as "editing is temporarily broken" rather than
 * as "this is not editable". That was the correct call at the time — ship the
 * endpoint before the control. The endpoint exists now, so the control does.
 *
 * ── EMAIL IS STILL NOT EDITABLE, AND STILL SAYS WHY ───────────────────────
 *
 * The address is the sign-in identity AND the destination every ticket is
 * delivered to, so changing it is a re-verification flow rather than a profile
 * field. It stays plain text with the reason attached, because the reason is
 * the difference between a missing feature and a deliberate one.
 *
 * ── SAVE IS EXPLICIT, AND SENDS ONLY WHAT MOVED ───────────────────────────
 *
 * No autosave. The Studio autosaves because a draft is long work that would be
 * painful to lose; five fields somebody opened on purpose are not, and an
 * autosaving identity form writes a half-typed name to the account somebody's
 * ticket is issued in. `changedFields` sends the diff, so saving a name never
 * re-asserts a gender the person did not open.
 */

export function ProfileEditor() {
  const { user, applyProfile } = useAuth();

  const initial = React.useMemo<ProfileForm>(
    () =>
      formFromUser(
        user ?? {
          full_name: '',
          phone: '',
          date_of_birth: null,
          gender: '',
          gender_self_described: '',
        },
      ),
    [user],
  );

  const [form, setForm] = React.useState<ProfileForm>(initial);
  const [saved, setSaved] = React.useState<ProfileForm>(initial);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [justSaved, setJustSaved] = React.useState(false);

  // The server is the source of truth: a refresh, or a change made in the
  // welcome flow, has to move this form rather than being overwritten by it.
  React.useEffect(() => {
    setForm(initial);
    setSaved(initial);
  }, [initial]);

  const errors = validateProfile(form);
  const changes = changedFields(saved, form);
  const dirty = changes !== null;
  const patch = (next: Partial<ProfileForm>) => {
    setJustSaved(false);
    setForm((current) => ({ ...current, ...next }));
  };

  const save = async () => {
    if (!changes) return;
    setBusy(true);
    setError(null);
    try {
      applyProfile(await updateProfile(changes));
      setSaved(form);
      setJustSaved(true);
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(false);
    }
  };

  return (
    // ── TWO COLUMNS ON DESKTOP, ONE ON A PHONE ─────────────────────────
    //
    // This was a single stack: identity card, then a tall form, then the
    // avatar uploader at the very bottom — so the picture was four screens
    // below the name it belongs to, and a 900px column of fields had nothing
    // beside it on a wide screen.
    //
    // The identity and the picture are the same subject, so they share a rail
    // that sticks while the form scrolls. The form keeps the full remaining
    // width and its groups are separated by rules rather than by three
    // stacked cards, which is what made it read as three unrelated forms.
    <div className="flex flex-col gap-block">
      {/* The section's heading, OUTSIDE the identity card. The card renders
          only once a profile has loaded, and a section whose title appears a
          moment after its form is a page that reflows under the reader — and
          leaves a screen reader with an unlabelled region until the fetch
          lands. */}
      <h2 className="sr-only">Profile</h2>

      <div className="grid gap-block lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start lg:gap-block-lg">
      <aside className="flex flex-col gap-block lg:sticky lg:top-sticky-top-lg">
        <ProfileHeader />
        <AvatarUpload />
      </aside>

      <form
        className="flex flex-col gap-block rounded-xl border border-border bg-surface p-card shadow-sm lg:p-card-lg"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Group title="Your name">
          <FieldRow label="Full name" id="profile-name" wide>
            <Input
              id="profile-name"
              value={form.fullName}
              maxLength={150}
              onChange={(event) => patch({ fullName: event.target.value })}
              placeholder="Asha Rao"
            />
          </FieldRow>
        </Group>

        <Group
          title="How we reach you"
        >
          <FieldRow label="Email address" id="profile-email" wide>
            {/* Plain text, not a disabled input. The address is the sign-in
                identity and the ticket destination, so changing it is a
                re-verification flow rather than a field — and a greyed-out box
                holding somebody's real address reads as broken. */}
            <div className="flex min-h-control flex-wrap items-center gap-2">
              <span className="text-body text-foreground">{user?.email}</span>
              <Badge variant={user?.email_verified ? 'success' : 'warning'}>
                {user?.email_verified ? (
                  <>
                    <Check className="size-3.5" aria-hidden />
                    Verified
                  </>
                ) : (
                  'Not verified'
                )}
              </Badge>
            </div>
          </FieldRow>

          <FieldRow
            label="Phone number"
            id="profile-phone"
          >
            <Input
              id="profile-phone"
              type="tel"
              value={form.phone}
              maxLength={20}
              onChange={(event) => patch({ phone: event.target.value })}
              placeholder="+91 98765 43210"
            />
          </FieldRow>
        </Group>

        <Group
          title="About you"
        >
          <FieldRow
            label="Date of birth"
            id="profile-dob"
            wide
            error={errors.dateOfBirth}
          >
            {/* Not `<input type="date">`. Reaching 2003 in Chrome's native
                popup meant scrolling a year column inside a postage stamp;
                this one has a year dropdown, which is the difference between
                usable and not for a birthday. */}
            <DayPicker
              id="profile-dob"
              value={form.dateOfBirth || null}
              onChange={(next) => patch({ dateOfBirth: next })}
              max={new Date().toISOString().slice(0, 10)}
              yearRange={{ from: new Date().getFullYear() - 100, to: new Date().getFullYear() }}
              placeholder="Pick your date of birth"
              className="sm:max-w-56"
            />
          </FieldRow>

          <GenderField
            className="sm:col-span-2"
            value={form.gender}
            selfDescribed={form.genderSelfDescribed}
            error={errors.genderSelfDescribed}
            onChange={(gender) => patch({ gender })}
            onSelfDescribedChange={(genderSelfDescribed) => patch({ genderSelfDescribed })}
          />
        </Group>

        {error ? (
          <p role="alert" className="text-caption text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button
            type="submit"
            disabled={!dirty || busy || Object.keys(errors).length > 0}
            className="rounded-full bg-cta px-pill text-cta-foreground hover:bg-cta-hover"
            leftIcon={busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : undefined}
          >
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
          {dirty ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setForm(saved);
                setError(null);
              }}
            >
              Discard
            </Button>
          ) : null}
          {/* Only after a real write, and only until the next keystroke. A
              permanent "saved" badge is indistinguishable from a stale one. */}
          {justSaved && !dirty ? (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 text-caption text-success-subtle-foreground"
            >
              <Check className="size-3.5" aria-hidden />
              Saved
            </span>
          ) : null}
        </div>
      </form>
      </div>
    </div>
  );
}

/**
 * The card at the top: who you are, and what is still blank.
 *
 * ── THE METER COUNTS ONLY WHAT THE PLATFORM USES ──────────────────────────
 *
 * Five things, each of which does something: the name goes on a ticket, the
 * picture appears beside you, the phone receives the SMS, the date meets a
 * door policy, the gender is there because some people want their profile to
 * say it. A meter that only reaches 100% by filling in fields nobody needs is
 * a nag with a progress bar on it.
 *
 * It disappears entirely at 100% rather than sitting there full. A completed
 * progress bar is a control with nothing left to do.
 */
function ProfileHeader() {
  const { user } = useAuth();
  if (!user) return null;

  const completeness = profileCompleteness(user);
  const name = user.full_name?.trim();

  return (
    <div className="flex flex-col gap-stack-lg rounded-xl border border-border bg-surface p-card shadow-sm">
      <div className="flex min-w-0 flex-col gap-1">
        {/* The person's NAME, not a section title — the section's own heading
            is above this card and always present. A `<p>` rather than a
            heading because "Asha Rao" is not a landmark; the outline should
            read Settings › Profile › Your name, not Settings › Asha Rao. */}
        <p className="truncate text-h3">{name || 'Your profile'}</p>
        <p className="truncate text-body-sm text-muted-foreground">{user.email}</p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-caption text-muted-foreground">
          {user.gender_display ? <span>{user.gender_display}</span> : null}
          {user.age !== null ? <span>{user.age}</span> : null}
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="size-3.5" aria-hidden />
            Member since{' '}
            {new Date(user.date_joined).toLocaleDateString('en-IN', {
              month: 'long',
              year: 'numeric',
            })}
          </span>
        </p>
      </div>

      {completeness.missing.length ? (
        <div className="flex items-center gap-4 rounded-lg border border-border bg-sunken p-4">
          <div className="hidden size-14 shrink-0 sm:block">
            <SceneAboutYou />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-body-sm font-medium">Finish your profile</span>
              <span className="text-caption tabular-nums text-muted-foreground">
                {completeness.done}/{completeness.total}
              </span>
            </div>
            <span
              className="h-1.5 w-full overflow-hidden rounded-full bg-border"
              role="progressbar"
              aria-valuenow={completeness.done}
              aria-valuemin={0}
              aria-valuemax={completeness.total}
              aria-label="Profile completeness"
            >
              <span
                className={cn('block h-full rounded-full bg-primary transition-[width] duration-slow')}
                style={{ width: `${completeness.ratio * 100}%` }}
              />
            </span>
            {/* ONE next thing, with the reason. A checklist of five is a
                to-do list nobody asked for; the single most useful missing
                field with a sentence saying why is an offer. */}
            <p className="text-caption text-muted-foreground">
              {completeness.missing[0]!.label} — {completeness.missing[0]!.why}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Group({
  title,
  blurb,
  children,
}: {
  title: string;
  /** Optional: several groups read better with the heading alone. */
  blurb?: string;
  children: React.ReactNode;
}) {
  return (
    // A rule between groups rather than a card around each: three cards inside
    // a card reads as three unrelated forms, and this is one form with three
    // parts. `first:border-0` so the top group does not sit under a line with
    // nothing above it.
    <section className="flex flex-col gap-stack-lg border-t border-border pt-block first:border-0 first:pt-0">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-body font-semibold text-foreground">{title}</h3>
        {blurb ? (
          <p className="max-w-prose text-caption text-muted-foreground">{blurb}</p>
        ) : null}
      </div>
      {/* Two columns for the short fields on a wide form. A name and a phone
          number on their own lines across 700px is a lot of travel for two
          words. */}
      <div className="grid gap-stack-lg sm:grid-cols-2">{children}</div>
    </section>
  );
}

function FieldRow({
  label,
  id,
  hint,
  error,
  wide,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  error?: string;
  /** Spans both columns. For a field whose HINT is a sentence rather than a
   *  few words — half a column turns those into five wrapped lines beside a
   *  one-line input. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', wide && 'sm:col-span-2')}>
      <label htmlFor={id} className="text-body-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-caption text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
