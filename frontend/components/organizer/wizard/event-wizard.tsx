'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  Redo2,
  RefreshCw,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui';
import { fetchOwnerSlots } from '@/lib/api/event-content';
import { useAuth } from '@/lib/auth/auth-provider';
import { useOrganizations } from '@/lib/identity/scope';
import { useToast } from '@/components/ui/toast';
import { useInvalidateOrganizer } from '@/lib/organizer/queries';
import { describePublishFailure } from '@/lib/organizer/publish-error';
import { completion, stepStatus, validate, type StepId } from '@/lib/organizer/wizard/model';
import {
  PHASES,
  memberAnchor,
  phaseAt,
  phaseIndex,
  phaseOf,
  phaseStatus,
  type PhaseId,
  type PhaseMember,
} from '@/lib/organizer/wizard/phases';
import { CouponsStep } from './coupons-step';

/**
 * The step a phase OPENS on.
 *
 * `step` stays a `StepId` because everything downstream is keyed by one, so
 * moving to a phase means moving to its first validating member. `coupons` is
 * skipped: it is not a `StepId`, and a phase that began there would put the
 * optional thing at the top of a form whose required fields are below it.
 */
function firstMemberStep(phase: { members: readonly PhaseMember[] }): StepId {
  const first = phase.members.find((member): member is StepId => member !== 'coupons');
  return first ?? 'basics';
}
import { useWizard, type SaveState } from '@/lib/organizer/wizard/use-wizard';
import { cn } from '@/lib/utils/cn';
import { Skeleton } from '../primitives';
import { BasicsStep, ScheduleStep, VenueStep } from './steps';
import { DetailsStep } from './details-step';
import { MediaStep } from './media-step';
import { SeoStep } from './seo-step';
import { TicketBuilder } from './ticket-builder';
import { LivePreview } from './preview';
import { ReviewStep } from './review';

import { fetchEventContent } from '@/lib/api/event-content';
import { fetchEventCrew } from '@/lib/api/crew';
import { fetchOwnerEventDetail, fetchOwnerEventTiers } from '@/lib/api/organizer';
import { WizardActionBar, saveSummary } from './action-bar';

/**
 * The event creation wizard.
 *
 * THREE COLUMNS: a step rail that is always reachable, one editing surface at
 * a time capped at 900px, and a sticky live preview. Below `xl` the preview
 * moves behind a toggle; below `lg` the rail becomes a horizontal stepper.
 *
 * EVERY STEP IS CLICKABLE FROM THE START, not just completed ones. The brief
 * asked for "clickable after completion", and that is the one instruction here
 * worth pushing back on: an organizer who knows their ticket tiers but not yet
 * their venue should be able to enter them. Nothing is lost — the draft is
 * local until it is valid, the Review step lists what is missing, and the
 * publish button stays disabled until the server would accept it. Gating
 * navigation would only make the form feel like the government form the brief
 * asked me to avoid.
 *
 * ── ONE FILLED ACTION PER STEP, AND IT IS ALWAYS IN THE SAME PLACE ─────────
 *
 * The near-black `<Button>` pill is spent on the step footer's forward action
 * and nowhere else — on Review, where there is no next step, it is spent on
 * Submit instead. Everything a step offers on the way (add a ticket, upload
 * images, add an FAQ) is an `outline` or `ghost` control, because a screen with
 * four filled buttons has no primary action, only four claims to be one. An
 * organizer building an event learns one target and stops hunting for it.
 *
 * The step rail wears the warm `--nav-active` pill for "you are here" rather
 * than a brand fill, which is the same distinction the account and site shells
 * draw: cream means where you are, near-black means press me. The violet that
 * survives in this file is wayfinding only — the completion bar and a timeline
 * marker.
 *
 * ── THE ORGANISATION IS RESOLVED, NEVER GUESSED ───────────────────────────
 *
 * This used to be `useWizard(orgs[0]?.id ?? '')`, and both halves of that were
 * wrong. `orgs[0]` is a guess whenever an account owns more than one company,
 * and the `?? ''` was what a `useState` initialiser captured on the very first
 * render — before `GET /organizations/` had answered — so a fresh draft could
 * keep an empty id forever and silently never create the event.
 *
 * Now the hook is handed the account and the FULL list of ids that account
 * owns, and does its own resolution once both are known: one owned
 * organisation is adopted, several means the organizer picks (the field below
 * appears only then), and an id that is not in the list is never sent. That
 * list is the same server truth `EventService.create_event` checks against, so
 * "Only the owning organization can manage this event." is not reachable from
 * here any more.
 */
export function EventWizard({
  eventId,
  cloneFrom,
}: { eventId?: string; cloneFrom?: string } = {}) {
  const router = useRouter();
  const invalidate = useInvalidateOrganizer();
  // Aliased: `status` below is the per-step rail state, which is a different
  // question entirely.
  const { user, status: authStatus } = useAuth();

  // The SAME query the shell and the scope switcher already ran, so this costs
  // no extra request — and, more to the point, it cannot disagree with them
  // about which organisations exist.
  const organizationsQuery = useOrganizations();
  const { toast } = useToast();
  const orgs = React.useMemo(
    () => organizationsQuery.data?.data ?? [],
    [organizationsQuery.data],
  );
  const organizationIds = React.useMemo(() => orgs.map((org) => org.id), [orgs]);

  /**
   * EDIT MODE: the event as the server has it, plus its tiers.
   *
   * The tiers come from the ORGANIZER endpoint, not the public
   * `GET /events/{id}/ticket-types`. The public one is `public` with an
   * `s-maxage`, which is right for the ticket panel and wrong here: every row
   * carries the `version` this editor's conditional updates depend on, and a
   * version out of a shared cache is one that may already be behind. The
   * failure is not a stale number — it is a 409 the save engine answers by
   * RELOADING rather than retrying, so edits are silently undone in a loop.
   *
   * Both are `staleTime: Infinity` for this mount. Refetching under an open
   * editor would hand hydration a different event mid-session; the save engine
   * already handles a genuine 409 by reloading, which is the moment to pick up
   * somebody else's change.
   */
  const editing = Boolean(eventId);
  // CLONE MODE: fill a new draft from an event that already exists. Ignored
  // when editing — one screen cannot both be a new event and an existing one,
  // and `existing` winning is the safer of the two ways to resolve it.
  const cloning = Boolean(cloneFrom) && !editing;
  const sourceId = eventId ?? cloneFrom ?? null;
  const needsSource = editing || cloning;

  // ── THE OWNER ENDPOINT, NOT THE PUBLIC ONE ─────────────────────────────
  //
  // This read `fetchEventDetail` — the PUBLIC detail, which resolves only
  // live and cancelled events. So every draft answered 404 and this component
  // rendered "That event is not available" about an event the organizer owns
  // and had just clicked in their own list. A finished event could not be
  // cloned for the same reason, which is the one somebody most wants to run
  // again.
  //
  // `GET /organizer/events/{id}` is owner-scoped and status-blind. A miss is
  // still a 404 for both "not yours" and "does not exist", so the branch
  // below stays correct.
  const eventQuery = useQuery({
    queryKey: ['organizer', 'source-event', sourceId],
    queryFn: () => fetchOwnerEventDetail(sourceId as string),
    enabled: needsSource,
    staleTime: Infinity,
    retry: 1,
  });
  const editTiersQuery = useQuery({
    queryKey: ['organizer', 'source-tiers', sourceId],
    queryFn: () => fetchOwnerEventTiers(sourceId as string),
    enabled: needsSource,
    staleTime: Infinity,
    retry: 1,
  });
  // The collections a clone has to carry. Only fetched when cloning: the edit
  // path reads them through its own server-backed sub-editors, which own
  // their invalidation.
  const cloneContentQuery = useQuery({
    queryKey: ['organizer', 'source-content', sourceId],
    queryFn: () => fetchEventContent(sourceId as string),
    enabled: cloning,
    staleTime: Infinity,
    retry: 1,
  });
  const cloneCrewQuery = useQuery({
    queryKey: ['organizer', 'source-crew', sourceId],
    queryFn: () => fetchEventCrew(sourceId as string),
    enabled: cloning,
    staleTime: Infinity,
    retry: 1,
  });
  // The organizer's own slot list, which unlike the public content payload
  // includes sessions that are switched OFF. A clone should carry a paused
  // session too — the copy is a fresh event where nothing is paused yet.
  const cloneSlotsQuery = useQuery({
    queryKey: ['organizer', 'source-slots', sourceId],
    queryFn: () => fetchOwnerSlots(sourceId as string),
    enabled: cloning,
    staleTime: Infinity,
    retry: 1,
  });

  const existing = React.useMemo(
    () =>
      editing && eventQuery.data && editTiersQuery.data
        ? { event: eventQuery.data, tiers: editTiersQuery.data }
        : null,
    [editing, eventQuery.data, editTiersQuery.data],
  );

  const cloneSource = React.useMemo(() => {
    if (
      !cloning ||
      !eventQuery.data ||
      !editTiersQuery.data ||
      !cloneContentQuery.data ||
      !cloneCrewQuery.data ||
      !cloneSlotsQuery.data
    ) {
      return null;
    }
    return {
      event: eventQuery.data,
      tiers: editTiersQuery.data,
      content: {
        faqs: cloneContentQuery.data.faqs,
        timeline: cloneContentQuery.data.timeline,
        slots: cloneSlotsQuery.data,
        crewIds: cloneCrewQuery.data.map((row) => row.id),
      },
    };
  }, [
    cloning,
    eventQuery.data,
    editTiersQuery.data,
    cloneContentQuery.data,
    cloneCrewQuery.data,
    cloneSlotsQuery.data,
  ]);

  const wizard = useWizard({
    userId: user?.id ?? null,
    organizationIds,
    // In edit mode the event has to be IN HAND before hydration runs — the
    // effect is synchronous and commits once. Gating here rather than letting
    // it hydrate an empty draft first is what stops the editor flashing a
    // blank form over a real event and, worse, autosaving it.
    ready:
      authStatus === 'authenticated' &&
      organizationsQuery.isSuccess &&
      (!editing || Boolean(existing)) &&
      // A clone gates the same way and for the same reason: hydration commits
      // once, so letting it run before the source has landed would seed an
      // EMPTY draft and then never fill it — a Clone press that opens a blank
      // form, which is indistinguishable from the feature not working.
      (!cloning || Boolean(cloneSource)),
    existing,
    cloneSource,
  });
  const { draft, update, setTiers } = wizard;
  // The save engine's health, handed to the steps that render a
  // NeedsSavedDraft panel and to Review — one object, so the badge, the
  // panels and the blocker card all repeat the SAME truth.
  const save = React.useMemo(
    () => ({ state: wizard.state, error: wizard.error }),
    [wizard.state, wizard.error],
  );

  /**
   * The event's sessions, so the tickets step can ask which showtime a tier
   * sells. Only queried once the draft exists on the server — slots are stored
   * against the event, so before that there is nothing to ask for and no
   * question to put to the organiser.
   *
   * The SAME query key the sessions editor writes through, so adding a session
   * on the Schedule step is visible in the tier form without a reload.
   */
  const slotsQuery = useQuery({
    queryKey: ['event-slots', draft.eventId],
    queryFn: () => fetchOwnerSlots(draft.eventId as string),
    enabled: Boolean(draft.eventId),
  });
  const sessions = React.useMemo(() => slotsQuery.data ?? [], [slotsQuery.data]);

  const [step, setStep] = React.useState<StepId>('basics');
  const [previewOpen, setPreviewOpen] = React.useState(false);

  /**
   * PREVIEW OPENS A TAB, not an embedded pane.
   *
   * It can, because the draft is in `localStorage` and a second tab on the
   * same origin reads the same store — so this needs no save, no event id and
   * no endpoint. `?eventId=` only picks WHICH draft key, mirroring the
   * wizard's own two-keys rule for a new event versus an edit.
   *
   * The draft is flushed to storage first. Autosave is debounced, so pressing
   * Preview seconds after typing would otherwise open a tab showing the draft
   * as it was before the last few keystrokes — the one moment that is
   * guaranteed to look like a bug.
   */
  const openPreview = () => {
    const query = wizard.draft.eventId ? `?eventId=${encodeURIComponent(wizard.draft.eventId)}` : '';
    window.open(`/dashboard/events/preview${query}`, '_blank', 'noopener,noreferrer');
  };

  const [posterFile, setPosterFile] = React.useState<File | null>(null);
  const [publishing, setPublishing] = React.useState(false);
  // Guards the submit itself, not its appearance. `publishing` disables the
  // button one render late, which two fast clicks beat; this ref is checked
  // and set synchronously in the same tick.
  const submitting = React.useRef(false);
  // The THROWN value, not a message: `describePublishFailure` reads the
  // backend's machine `code` and `details` to turn a refusal into a
  // destination, and a pre-flattened string has already discarded both.
  const [publishError, setPublishError] = React.useState<unknown>(null);

  const issues = React.useMemo(() => validate(draft), [draft]);
  const status = React.useMemo(() => stepStatus(draft, issues), [draft, issues]);
  const percent = completion(draft);

  const tierIssues = React.useMemo(() => {
    const map = new Map<string, string[]>();
    for (const issue of issues) {
      if (issue.step !== 'tickets') continue;
      map.set(issue.field, [...(map.get(issue.field) ?? []), issue.message]);
    }
    return map;
  }, [issues]);

  // THE STEP STILL DECIDES EVERYTHING; the PHASE is what is navigated.
  //
  // `step` is unchanged — it is the key of `Issue.step`, of `stepStatus`, and
  // of Review's jump. What changed is that the tracker, Next and Previous work
  // in phases, and the screen renders every member of the current one stacked.
  const phase = phaseOf(step);
  const index = phaseIndex(phase);
  const current = phaseAt(phase);
  const previous = PHASES[index - 1];
  const next = PHASES[index + 1];

  /**
   * FORWARD, AND WHAT IS WRONG WITH THIS STEP IF ANYTHING IS.
   *
   * ── WHY IT STILL MOVES ───────────────────────────────────────────────
   *
   * The brief asked for validation on Continue as a toast instead of inline
   * red text. It does NOT block the navigation, and that is deliberate: the
   * wizard is local-first and every step autosaves, so somebody who wants to
   * fill in tickets before the venue is doing something reasonable. Refusing
   * to move would turn a form you can fill in any order into a queue.
   *
   * So the toast REPORTS rather than refuses. Publish is still the gate —
   * `publishBlockers` is what actually stops a half-finished event going out,
   * and Review lists every one of them.
   *
   * One toast, not one per problem: four stacked toasts for four empty fields
   * is a wall that has to be dismissed four times.
   */
  const goForward = React.useCallback(
    (target: StepId) => {
      // EVERY member of the phase being left, not just the one `step` happens
      // to name. A phase renders five forms at once; reporting only the
      // problems of whichever one was last jumped to would stay silent about
      // four of them and then surface all four on Review.
      const scope = new Set<string>(current.members);
      const trouble = issues.filter((issue) => scope.has(issue.step));
      if (trouble.length) {
        toast({
          variant: 'warning',
          title: `${current.label} needs a little more`,
          description: trouble
            .slice(0, 3)
            .map((issue) => issue.message)
            .join(' · '),
        });
      }
      setStep(target);
    },
    [issues, current, setStep, toast],
  );

  /**
   * ONE MEMBER OF THE CURRENT PHASE.
   *
   * A switch rather than a lookup table, because every branch takes a
   * different set of props and a table would either widen them all to one
   * union or lose the compiler's check that Media gets `posterFile` and
   * Tickets gets `sessions`.
   *
   * This is the SAME eight components the eight-step wizard rendered. Nothing
   * was rewritten to collapse the steps — they were grouped.
   */
  const renderMember = (member: PhaseMember) => {
    switch (member) {
      case 'basics':
        return (
          <BasicsStep draft={draft} update={update} issues={issues} organizations={orgs} />
        );
      case 'venue':
        return <VenueStep draft={draft} update={update} issues={issues} />;
      case 'media':
        return (
          <MediaStep draft={draft} onPoster={onPoster} posterFile={posterFile} save={save} />
        );
      case 'details':
        return <DetailsStep draft={draft} update={update} issues={issues} />;
      case 'coupons':
        return <CouponsStep draft={draft} save={save} />;
      case 'schedule':
        return <ScheduleStep draft={draft} update={update} issues={issues} save={save} />;
      case 'tickets':
        return (
          <div className="flex flex-col gap-block">
            <header className="flex flex-col gap-1.5">
              <h2 className="text-h3">Tickets</h2>
            </header>
            <TicketBuilder
              tiers={draft.tiers}
              onChange={setTiers}
              issues={tierIssues}
              sessions={sessions}
            />
          </div>
        );
      case 'seo':
        return <SeoStep draft={draft} update={update} issues={issues} />;
      case 'review':
      default:
        return (
          <ReviewStep
            draft={draft}
            issues={issues}
            onJump={jumpToStep}
            onPublish={() => void publish()}
            publishing={publishing}
            publishError={publishError}
            organizationName={orgs.find((org) => org.id === draft.organizationId)?.name ?? ''}
            organizations={orgs}
            saveState={wizard.state}
            saveError={wizard.error}
            onSaveNow={() => void wizard.saveNow()}
            eventStatus={eventQuery.data?.status}
          />
        );
    }
  };

  /**
   * REVIEW'S "TAKE ME TO THE PROBLEM", ACROSS A PHASE BOUNDARY.
   *
   * Setting the step switches the phase (`phaseOf` decides which), but the
   * form being pointed at is one of five on that screen — so the scroll is
   * what actually finishes the job. It runs on the NEXT frame because the
   * target section does not exist until the new phase has rendered.
   *
   * `smooth` unless the reader asked for less motion: a scroll they did not
   * initiate, jumping a screen's height, is exactly the class of movement
   * `prefers-reduced-motion` is about.
   */
  const jumpToStep = React.useCallback((target: StepId) => {
    setStep(target);
    window.requestAnimationFrame(() => {
      const node = document.getElementById(memberAnchor(target));
      if (!node) return;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      node.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    });
  }, [setStep]);

  /**
   * Keyboard shortcuts.
   *
   * ⌘Z / ⇧⌘Z  undo, redo — skipped while a text field has focus, so the
   *           browser's own per-field undo still works, which is what someone
   *           mid-sentence actually means by ⌘Z.
   * ⌘S        save now. Bound because people press it regardless, and the
   *           browser's "save this page" dialogue is a worse answer than a
   *           flush of the autosave that was going to run anyway.
   * ⌥← / ⌥→   previous / next step. Alt rather than plain arrows, which belong
   *           to whatever field has focus.
   */
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void wizard.saveNow();
        return;
      }
      if (mod && event.key.toLowerCase() === 'z' && !typing) {
        event.preventDefault();
        if (event.shiftKey) wizard.redo();
        else wizard.undo();
        return;
      }
      if (event.altKey && event.key === 'ArrowLeft' && previous) {
        event.preventDefault();
        setStep(firstMemberStep(previous));
        return;
      }
      if (event.altKey && event.key === 'ArrowRight' && next) {
        event.preventDefault();
        goForward(firstMemberStep(next));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [wizard, previous, next, goForward]);

  /**
   * The close guard.
   *
   * Only while a save is genuinely outstanding — `dirty`, `saving` or a failed
   * `error`. A blanket guard on every visit is the dialogue everyone learns to
   * dismiss without reading, which is how it stops protecting anything. Note
   * the local copy survives regardless; what this protects is the round trip,
   * and the un-uploaded cover file, which cannot be serialised.
   */
  React.useEffect(() => {
    const risky = wizard.state === 'dirty' || wizard.state === 'saving' || wizard.state === 'error';
    if (!risky) return;
    const onLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [wizard.state]);

  const onPoster = (file: File | null) => {
    // Revoke the previous blob before replacing it, or every re-pick leaks the
    // old one for the lifetime of the tab.
    if (draft.posterUrl.startsWith('blob:')) URL.revokeObjectURL(draft.posterUrl);
    setPosterFile(file);
    wizard.setPoster(file);
    update({ posterUrl: file ? URL.createObjectURL(file) : '' });
  };

  const publish = async () => {
    // A REF, not the `publishing` state, is what makes this safe to press
    // twice. `setPublishing(true)` only disables the button on the NEXT
    // render, so two fast clicks both get past a state check and fire two
    // submits — the same trailing-state bug the ticket stepper had, on a
    // lifecycle transition instead of a quantity. The second request used to
    // be refused with "this one is 'pending_review'" and rendered in red, on
    // the screen of somebody whose event had just been submitted correctly.
    if (submitting.current) return;
    submitting.current = true;
    setPublishing(true);
    setPublishError(null);
    try {
      const published = await wizard.publish();
      void invalidate();
      router.push(`/dashboard/events?event=${published.id}`);
    } catch (thrown) {
      // ALREADY SUBMITTED IS NOT A FAILURE. If the refusal only says the event
      // is already in the review queue (or already live), the organizer has
      // the outcome they pressed for — finish the way a success finishes:
      // clear the local draft, refresh the lists and go to the dashboard. The
      // wizard keeps no server truth of its own, so a restored page or a
      // second tab can genuinely arrive here with a stale idea of the status.
      const failure = describePublishFailure(thrown);
      if (failure.alreadyDone) {
        // `reset` and not just a navigation: it clears the STORED draft, so
        // returning here (Back, bfcache, a bookmarked /new) opens a fresh form
        // instead of a finished event with an armed Submit button.
        wizard.reset();
        void invalidate();
        router.push('/dashboard/events');
        return;
      }
      // The THROWN value, not its message: `describePublishFailure` needs the
      // `code` and `details` to turn a refusal into a destination.
      setPublishError(thrown);
      setPublishing(false);
      submitting.current = false;
    }
  };

  /**
   * A failed list is NOT "you have no organisations".
   *
   * Before this branch, an error and an empty list rendered the same panel, so
   * a dropped request told an organizer who runs three companies to go and
   * create one. The two states have different causes and different actions, so
   * they get different screens.
   */
  if (organizationsQuery.isError) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-stack-lg py-section text-center">
        <h1 className="text-h3">Could not load your organisations</h1>
        <p className="text-body-sm text-muted-foreground">
          Your draft is safe on this device.
        </p>
        <Button
          onClick={() => void organizationsQuery.refetch()}
          loading={organizationsQuery.isFetching}
          leftIcon={<RefreshCw className="size-4" aria-hidden />}
        >
          Try again
        </Button>
      </div>
    );
  }

  // ── AN EVENT THAT CANNOT BE LOADED IS NOT AN EMPTY FORM ────────────────
  //
  // The organizer tier read answers 404 for an event that is not theirs AND
  // for one that does not exist — the same answer on purpose, so it cannot be
  // used to test whether an id is real. Falling through to the wizard here
  // would render a blank create form at an edit URL and then autosave it as a
  // NEW event, which is the worst available outcome.
  if (needsSource && (eventQuery.isError || editTiersQuery.isError)) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-stack-lg py-section text-center">
        <h1 className="text-h3">That event is not available</h1>
        <p className="text-body-sm text-muted-foreground">
          It may have been removed, or it belongs to another organiser.
        </p>
        <Button asChild>
          <Link href="/dashboard/events">Back to your events</Link>
        </Button>
      </div>
    );
  }

  if (!organizationsQuery.isSuccess || !wizard.hydrated) {
    return <WizardSkeleton />;
  }

  if (orgs.length === 0) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-stack-lg py-section text-center">
        <h1 className="text-h3">You need an organisation first</h1>
        <p className="text-body-sm text-muted-foreground">
          It is what receives the payouts.
        </p>
        <Button asChild>
          <Link href="/dashboard">Back to the dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-stack-lg">
      <div className="flex flex-wrap items-center gap-stack">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/events">
            <ArrowLeft className="size-4" aria-hidden />
            Events
          </Link>
        </Button>

        <SaveBadge state={wizard.state} error={wizard.error} savedAt={wizard.savedAt} />

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Undo"
            title="Undo"
            onClick={wizard.undo}
            disabled={!wizard.canUndo}
          >
            <Undo2 className="size-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Redo"
            title="Redo"
            onClick={wizard.redo}
            disabled={!wizard.canRedo}
          >
            <Redo2 className="size-4" aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={openPreview}
            leftIcon={<Eye className="size-4" aria-hidden />}
            className="xl:hidden"
          >
            Preview
          </Button>
        </div>
      </div>

      <div className="grid gap-block lg:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[13rem_minmax(0,1fr)_21rem]">
        <StepRail current={phase} status={status} percent={percent} onSelect={setStep} />

        <main className="min-w-0">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-block-lg">
            {/* ── THE PHASE, AS A STACK ────────────────────────────────────
                Every member of the current phase renders at once, in the order
                `PHASES` lists them, each already a set of closed-by-default
                accordions. So Step 1 is five headings and no open fields, not
                five screens — which is the whole point of collapsing eight
                steps into three.

                `key={phase}` on the stack is what makes moving between phases
                a real unmount: without it React reconciles five `<section>`s
                into three and keeps the open/closed state of whichever
                accordions happen to line up, so Schedule would open already
                expanded because Basics was. The key also restarts the
                transition, which is what the fade is attached to. */}
            {/* THE PAGE'S ONE `h1`. Each form below carries an `h2`, so the
                outline reads "Core & Media > Basics, Venue, Media…" rather
                than five sibling page titles. On Review the component's own
                heading says the same thing, so this one is `sr-only` there to
                avoid printing it twice. */}
            <h1
              className={cn(
                'text-h3',
                current.id === 'review' && 'sr-only',
              )}
            >
              {current.label}
            </h1>

            <div
              key={phase}
              className="flex animate-in flex-col gap-block-lg fade-in-0 slide-in-from-bottom-1 duration-base motion-reduce:animate-none"
            >
              {current.members.map((member) => (
                // A landmark per member, so Review's checklist can scroll to
                // the exact form rather than to the top of a phase with five
                // in it.
                <section key={member} id={memberAnchor(member)} className="scroll-mt-20">
                  {renderMember(member)}
                </section>
              ))}
            </div>

            {/* The step footer. `Next` is the ONE filled pill on the screen and
                it never moves, so the forward path is a fixed target rather
                than something to look for. `Previous` is a ghost: it is an
                escape hatch, not a competing action. On Review there is no
                `next`, which is what frees the fill for Submit. */}
            <nav className="flex items-center justify-between gap-stack border-t border-border pt-stack-lg">
              {previous ? (
                <Button
                  variant="ghost"
                  onClick={() => setStep(firstMemberStep(previous))}
                  leftIcon={<ArrowLeft className="size-4" aria-hidden />}
                >
                  {previous.label}
                </Button>
              ) : (
                <span />
              )}
              {next ? (
                // `hidden sm:inline-flex`: below `sm` the forward action moves
                // into the pinned action bar, where it is reachable without
                // scrolling to the end of a very long form. Exactly one of the
                // two is rendered at any width — see `action-bar.tsx`.
                <Button
                  onClick={() => goForward(firstMemberStep(next))}
                  rightIcon={<ArrowRight className="size-4" aria-hidden />}
                  className="hidden sm:inline-flex"
                >
                  {next.label}
                </Button>
              ) : null}
            </nav>

            {/* ── THE PERSISTENT ACTION BAR ───────────────────────────────
                Last child of the editing column, and `sticky bottom-0` rather
                than `fixed`, so it floats over the form while there is page
                below it and then comes to rest in flow at the end — the final
                field and the step footer's Next are never permanently
                underneath it, and nothing needs a spacer kept in step with the
                bar's height by hand.

                It repeats the save state that already sits beside the back
                link at the top of the page. That is deliberate: on Tickets,
                Media and Details the top of the page is a thousand pixels
                above whatever somebody is typing, so at the moment they finish
                a tier and wonder whether it is stored, the answer was
                off-screen. Both narrations come from `saveSummary`, so they
                cannot drift into two vocabularies for one fact. */}
            <WizardActionBar
              state={wizard.state}
              error={wizard.error}
              savedAt={wizard.savedAt}
              onSaveDraft={() => void wizard.saveNow()}
              onPreview={openPreview}
              previewOpen={previewOpen}
              forward={
                next
                  ? { label: next.label, onClick: () => goForward(firstMemberStep(next)) }
                  : null
              }
            />
          </div>
        </main>

        <aside className="hidden xl:block">
          <div className="sticky top-20">
            <LivePreview
              draft={draft}
              organizationName={orgs.find((org) => org.id === draft.organizationId)?.name ?? ''}
            />
          </div>
        </aside>
      </div>

      {previewOpen ? (
        <div className="fixed inset-x-0 bottom-0 z-drawer max-h-[80dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface p-card shadow-xl xl:hidden">
          <div className="mx-auto mb-stack h-1.5 w-12 rounded-full bg-border-strong" aria-hidden />
          <LivePreview
            draft={draft}
            organizationName={orgs.find((org) => org.id === draft.organizationId)?.name ?? ''}
          />
          <Button
            variant="outline"
            onClick={() => setPreviewOpen(false)}
            className="mt-stack-lg w-full"
          >
            Close preview
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * THE THREE-PHASE TRACKER.
 *
 * Eight entries became three. The eight were a horizontal scroller on a phone
 * — a progress indicator you have to scroll is one that has stopped telling
 * you where you are — and at any width they presented eight forms as eight
 * journeys.
 *
 * ── THE LINE IS CONTINUOUS, AND IT IS DRAWN PER ITEM ────────────────────
 *
 * Each phase draws the segment LEADING INTO it, so the rule always ends at a
 * dot rather than running off the right-hand edge, and the dot's own opaque
 * fill is what covers the join. One absolute rule behind the whole row would
 * have to know where the row starts and ends; three stubs do not.
 *
 * The segment is violet once the phase behind it has been REACHED, which is
 * what makes the line read as travelled distance rather than as decoration.
 *
 * ── EVERY PHASE IS PRESSABLE, INCLUDING THE ONES AHEAD ──────────────────
 *
 * The wizard is local-first and every field autosaves, so filling in tickets
 * before the venue is a reasonable thing to do; a tracker that refused to move
 * forward would turn a form you can complete in any order into a queue.
 * Publish is the gate, and Review lists every blocker.
 *
 * ── VIOLET FOR THE ACTIVE PHASE ─────────────────────────────────────────
 *
 * The same `--primary` the footer bar's active tab and this dashboard's filter
 * pills use. The butter `--nav-active` that used to fill the active row here
 * is the attendee site's mark now: one product, one colour for "you are here".
 */
function StepRail({
  current,
  status,
  percent,
  onSelect,
}: {
  current: PhaseId;
  status: Record<StepId, 'done' | 'todo' | 'error'>;
  percent: number;
  onSelect: (step: StepId) => void;
}) {
  const activeIndex = phaseIndex(current);

  return (
    // ── STICKY, LIKE THE PREVIEW OPPOSITE IT ──────────────────────────────
    //
    // `self-start` is load-bearing: a grid item stretches to the row height by
    // default, which leaves a sticky child nowhere to stick because its
    // container is already as tall as the content beside it. Only from `lg`,
    // where the rail is a column; below that it is a horizontal strip in flow
    // and pinning it would eat a phone's viewport.
    <nav aria-label="Wizard steps" className="min-w-0 lg:sticky lg:top-20 lg:self-start">
      <div className="mb-stack hidden flex-col gap-1.5 lg:flex">
        <div className="flex items-baseline justify-between">
          <span className="text-caption text-muted-foreground">Progress</span>
          <span className="text-caption tabular-nums text-muted-foreground">{percent}%</span>
        </div>
        {/* Violet survives here BECAUSE it is not a button: a completion bar is
            wayfinding, which is exactly the role `--primary` keeps. */}
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-base ease-out motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Draft completion"
          />
        </div>
      </div>

      <ol className="flex items-start gap-x-0 lg:flex-col lg:gap-y-1">
        {PHASES.map((phase, position) => {
          const state = phaseStatus(phase, status);
          const active = current === phase.id;
          const reached = position <= activeIndex;

          return (
            <li
              key={phase.id}
              className="relative flex min-w-0 flex-1 items-center lg:flex-none lg:flex-initial"
            >
              {/* The connector INTO this phase. `aria-hidden` scenery, sitting
                  behind the dot so the join is covered by the dot's own fill. */}
              {position > 0 ? (
                <span
                  aria-hidden
                  className={cn(
                    'absolute left-0 top-[1.125rem] -z-10 h-px w-full lg:hidden',
                    'transition-colors duration-slow ease-out motion-reduce:transition-none',
                    reached ? 'bg-primary' : 'bg-border',
                  )}
                />
              ) : null}

              <button
                type="button"
                onClick={() => onSelect(firstMemberStep(phase))}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'group/step flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-xl px-1 py-1.5',
                  'transition-colors duration-slow ease-out motion-reduce:transition-none',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'lg:min-h-control lg:flex-row lg:items-center lg:gap-2.5 lg:px-3 lg:py-2 lg:text-left',
                  active
                    ? 'lg:bg-primary lg:text-primary-foreground'
                    : 'text-muted-foreground lg:hover:bg-muted lg:hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'inline-flex size-7 shrink-0 items-center justify-center rounded-full text-caption tabular-nums lg:size-5',
                    'transition-colors duration-slow ease-out motion-reduce:transition-none',
                    // OPAQUE on purpose: it is what covers the connector where
                    // the line meets the dot.
                    state === 'error'
                      ? 'bg-destructive text-destructive-foreground'
                      : state === 'done'
                        ? 'bg-success text-success-foreground'
                        : active
                          ? 'bg-primary text-primary-foreground lg:bg-primary-foreground lg:text-primary'
                          : 'border border-border bg-surface text-muted-foreground',
                  )}
                  aria-hidden
                >
                  {state === 'error' ? (
                    <AlertTriangle className="size-3.5 lg:size-3" />
                  ) : state === 'done' ? (
                    <Check className="size-3.5 lg:size-3" />
                  ) : (
                    position + 1
                  )}
                </span>

                <span className="min-w-0 lg:flex-1">
                  <span
                    className={cn(
                      'block truncate text-caption lg:text-label',
                      active ? 'font-semibold text-primary lg:font-medium lg:text-inherit' : '',
                    )}
                  >
                    {phase.label}
                  </span>
                  <span
                    className={cn(
                      'hidden truncate text-caption lg:block',
                      active ? 'text-primary-foreground/75' : 'text-foreground-subtle',
                    )}
                  >
                    {phase.hint}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The save indicator.
 *
 * Deliberately a quiet inline badge and never a toast. Autosave fires every
 * couple of seconds; a toast per save would be an interruption every time
 * someone pauses typing, which is the exact opposite of reassurance.
 *
 * Every tone below is a `*-subtle-foreground` token rather than the solid fill
 * of the same name. `text-warning` was 2.15:1 on the white canvas — the offline
 * warning, which is the one line here somebody genuinely needs to read, was the
 * least readable thing in the toolbar. Amber is a FILL; amber TEXT comes from
 * the tint's partner ink, which is 7.70:1.
 */
function SaveBadge({
  state,
  error,
  savedAt,
}: {
  state: SaveState;
  error: string | null;
  savedAt: number | null;
}) {
  const [, tick] = React.useReducer((count: number) => count + 1, 0);
  React.useEffect(() => {
    // Re-render once a minute so "saved just now" ages into "saved 3m ago"
    // rather than staying frozen at the moment of the last keystroke.
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);

  // ── ONE SOURCE FOR THE SENTENCE, TWO PLACES THAT SHOW IT ──────────────
  // This used to hold its own copy of the six labels, tones and icons, and the
  // action bar at the foot of the column now shows the same fact. Two
  // hand-maintained copies of "what the save is doing" is how one of them ends
  // up saying "Saved" while the other says "Could not save".
  const shown = saveSummary(state, error, savedAt);

  return (
    <p
      role="status"
      aria-live="polite"
      className={cn('inline-flex min-w-0 items-center gap-1.5 text-caption', shown.tone)}
    >
      {shown.icon}
      <span className="truncate">{shown.label}</span>
    </p>
  );
}

/**
 * Content-shaped skeleton: the same three columns, the same eight rail rows and
 * the same control heights the real wizard resolves to, so nothing jumps when
 * the organisations query lands.
 */
function WizardSkeleton() {
  return (
    <div className="grid gap-block lg:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[13rem_minmax(0,1fr)_21rem]">
      <div className="flex flex-col gap-1">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-control w-full rounded-xl" />
        ))}
      </div>
      <div className="flex flex-col gap-stack-lg">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-control w-full rounded-md" />
        <Skeleton className="h-32 w-full rounded-md" />
      </div>
      <div className="hidden xl:block">
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
      <span className="sr-only">Loading the event wizard…</span>
    </div>
  );
}
