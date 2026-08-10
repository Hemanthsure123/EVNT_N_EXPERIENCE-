'use client';

import * as React from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DayPicker } from '@/components/ui/day-picker';
import {
  SceneAboutYou,
  SceneOnboardingDone,
  SceneWelcome,
  SceneYourName,
  SceneYourPhoto,
} from '@/components/illustrations/onboarding-scenes';
import { AvatarUpload } from '@/components/account/avatar-upload';
import { GenderField } from '@/components/account/profile-fields';
import { useAuth } from '@/lib/auth/auth-provider';
import { completeOnboarding, needsOnboarding, updateProfile } from '@/lib/api/profile';
import { errorMessage } from '@/lib/api/errors';
import {
  changedFields,
  formFromUser,
  validateProfile,
  type ProfileForm,
} from '@/lib/account/profile-form';
import { cn } from '@/lib/utils/cn';

/**
 * The welcome flow: four screens, and every one of them can be walked past.
 *
 * ── IT IS NEVER A WALL ────────────────────────────────────────────────────
 *
 * The single most important property. Somebody who verified their email did so
 * to buy a ticket, and a form standing between them and the product is how a
 * platform loses the people who only ever wanted a ticket. So:
 *
 *   · every step has a visible Skip,
 *   · nothing is required — not one field,
 *   · closing it counts as answering, and it does not come back.
 *
 * `POST /auth/me/onboarding` is what records "answered", separately from the
 * profile PATCH, precisely so a skip is recordable. Folding the mark into the
 * PATCH would make a skip indistinguishable from a request that never arrived.
 *
 * ── IT SAVES PER STEP, NOT AT THE END ─────────────────────────────────────
 *
 * Each Next writes what that step collected. Somebody who fills in their name
 * and then closes the tab keeps their name — where a single submit at the end
 * would throw away everything they typed, which is the worst possible outcome
 * for a form nobody asked for.
 *
 * ── AND IT SAYS WHY IT IS ASKING ──────────────────────────────────────────
 *
 * Every field carries the reason it exists: the name is what gets printed on
 * the ticket, the phone is where the confirmation SMS goes, the date is
 * because some events have an age policy at the door. A form that asks without
 * saying why is a form people abandon, and each of those reasons is true —
 * they are the same ones `profileCompleteness` gives.
 */

type StepId = 'welcome' | 'name' | 'photo' | 'about' | 'done';

const STEPS: readonly StepId[] = ['welcome', 'name', 'photo', 'about', 'done'];
/** The middle three. `welcome` and `done` are not work, so counting them would
 *  make the progress bar lie about how much is left. */
const WORK_STEPS = 3;

export function Onboarding() {
  const { user, status, applyProfile } = useAuth();
  const [dismissed, setDismissed] = React.useState(false);

  const open = !dismissed && status === 'authenticated' && needsOnboarding(user);
  if (!open || !user) return null;

  return (
    <OnboardingDialog
      onClose={() => {
        setDismissed(true);
        // Fire-and-forget on purpose: the mark is a courtesy to the NEXT
        // visit, and blocking the close on a network round trip would make
        // dismissing a form feel like submitting one. If it fails, the flow
        // opens once more, which is the harmless direction to fail in.
        void completeOnboarding()
          // The response IS the fresh profile, so this is a swap rather than a
          // refetch — asking `/auth/me` again would be a round trip to learn
          // what we were just told.
          .then(applyProfile)
          .catch(() => {});
      }}
    />
  );
}

function OnboardingDialog({ onClose }: { onClose: () => void }) {
  const { user, applyProfile } = useAuth();
  const [step, setStep] = React.useState<StepId>('welcome');
  const [form, setForm] = React.useState<ProfileForm>(() =>
    formFromUser(
      user ?? {
        full_name: '',
        phone: '',
        date_of_birth: null,
        gender: '',
        gender_self_described: '',
      },
    ),
  );
  const [saved, setSaved] = React.useState<ProfileForm>(form);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const errors = validateProfile(form);
  const index = STEPS.indexOf(step);

  const patch = (changes: Partial<ProfileForm>) => setForm((current) => ({ ...current, ...changes }));

  /** Save what this step collected, then move. A failure keeps the person
   *  where they are with a sentence, rather than losing what they typed. */
  const advance = async (to: StepId) => {
    const changes = changedFields(saved, form);
    if (changes) {
      setBusy(true);
      setError(null);
      try {
        applyProfile(await updateProfile(changes));
        setSaved(form);
      } catch (thrown) {
        setError(errorMessage(thrown));
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    setStep(to);
  };

  const next = STEPS[index + 1] ?? 'done';
  const back = STEPS[index - 1] ?? 'welcome';

  return (
    // Not a Radix Dialog: this has no dismissable overlay by design — the way
    // out is the Skip control, which is also what RECORDS the answer. A scrim
    // that closes on click would let somebody leave without the mark and be
    // asked again tomorrow.
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-drawer flex items-end justify-center bg-overlay/70 p-0 sm:items-center sm:p-6"
    >
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-lg sm:rounded-2xl">
        {/* The artwork band. It is the largest thing on the screen because the
            person did not come here for a form, and a picture is what makes
            the ask feel like a welcome rather than a gate. */}
        <div className="relative flex justify-center bg-sunken px-6 pt-6">
          <div className="h-32 w-44 sm:h-40 sm:w-56">
            {step === 'welcome' ? (
              <SceneWelcome />
            ) : step === 'name' ? (
              <SceneYourName />
            ) : step === 'photo' ? (
              <SceneYourPhoto />
            ) : step === 'about' ? (
              <SceneAboutYou />
            ) : (
              <SceneOnboardingDone />
            )}
          </div>
        </div>

        {/* Progress over the three WORK steps only. Counting the welcome and
            the finish would make the bar claim two-fifths done before
            anything has been asked. */}
        {index > 0 && index < STEPS.length - 1 ? (
          <div className="flex gap-1.5 px-6 pt-4" aria-hidden>
            {Array.from({ length: WORK_STEPS }, (_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors duration-base',
                  i < index ? 'bg-primary' : 'bg-border',
                )}
              />
            ))}
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 'welcome' ? (
            <Body
              title="Welcome to Curatix"
              blurb="Two minutes now and every booking afterwards is one tap. You can skip any of it — nothing here is required."
            />
          ) : step === 'name' ? (
            <Body
              title="What should we call you?"
              blurb="Your name goes on every ticket you book, and door staff check it against your ID."
            >
              <Field label="Full name" id="onb-name">
                <Input
                  id="onb-name"
                  value={form.fullName}
                  maxLength={150}
                  autoFocus
                  onChange={(event) => patch({ fullName: event.target.value })}
                  placeholder="Asha Rao"
                />
              </Field>
              <Field
                label="Phone number"
                id="onb-phone"
                hint="Booking confirmations and reminders go out by SMS as well as email. Leave it blank to stick to email."
              >
                <Input
                  id="onb-phone"
                  type="tel"
                  value={form.phone}
                  maxLength={20}
                  onChange={(event) => patch({ phone: event.target.value })}
                  placeholder="+91 98765 43210"
                />
              </Field>
            </Body>
          ) : step === 'photo' ? (
            <Body
              title="Add a photo"
              blurb="Optional — without one you get your initials."
            >
              <div className="flex justify-center py-2">
                <AvatarUpload />
              </div>
            </Body>
          ) : step === 'about' ? (
            <Body
              title="A little about you"
              blurb="Both optional, and both easy to change later."
            >
              <Field
                label="Date of birth"
                id="onb-dob"
                hint="Some events have an age policy at the door."
                error={errors.dateOfBirth}
              >
                <DayPicker
                  id="onb-dob"
                  value={form.dateOfBirth || null}
                  onChange={(next) => patch({ dateOfBirth: next })}
                  max={new Date().toISOString().slice(0, 10)}
                  yearRange={{ from: new Date().getFullYear() - 100, to: new Date().getFullYear() }}
                  placeholder="Pick your date of birth"
                />
              </Field>
              <GenderField
                value={form.gender}
                selfDescribed={form.genderSelfDescribed}
                error={errors.genderSelfDescribed}
                onChange={(gender) => patch({ gender })}
                onSelfDescribedChange={(genderSelfDescribed) => patch({ genderSelfDescribed })}
              />
            </Body>
          ) : (
            <Body
              title="That is everything"
              blurb="Your profile is ready. Change any of it from your account settings whenever you like."
            />
          )}

          {error ? (
            <p role="alert" className="mt-4 text-caption text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-6 py-4">
          {index > 0 && step !== 'done' ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStep(back)}
              disabled={busy}
              leftIcon={<ArrowLeft className="size-4" aria-hidden />}
            >
              Back
            </Button>
          ) : null}

          <div className="ml-auto flex items-center gap-2">
            {step !== 'done' ? (
              // Always visible, never a link buried in small print. A skip that
              // is hard to find is a wall with a door painted on it.
              <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
                Skip for now
              </Button>
            ) : null}
            <Button
              onClick={() => (step === 'done' ? onClose() : void advance(next))}
              disabled={busy || Object.keys(errors).length > 0}
              className="rounded-full bg-cta px-pill text-cta-foreground hover:bg-cta-hover"
              rightIcon={
                busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : step === 'done' ? (
                  <Check className="size-4" aria-hidden />
                ) : (
                  <ArrowRight className="size-4" aria-hidden />
                )
              }
            >
              {step === 'welcome' ? 'Get started' : step === 'done' ? 'Start browsing' : 'Continue'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Body({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5 text-center">
        <h2 id="onboarding-title" className="text-h4">
          {title}
        </h2>
        <p className="text-body-sm text-muted-foreground">{blurb}</p>
      </div>
      {children ? <div className="flex flex-col gap-4 pt-1">{children}</div> : null}
    </div>
  );
}

function Field({
  label,
  id,
  hint,
  error,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-body-sm font-medium">
        {label} <span className="font-normal text-muted-foreground">— optional</span>
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
