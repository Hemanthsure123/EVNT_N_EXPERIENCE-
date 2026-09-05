'use client';

import * as React from 'react';
import { BookOpen, Check, Copy } from 'lucide-react';
import {
  Button,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui';

/**
 * A worked example of an event description, as a reading aid.
 *
 * ── WHY THIS IS A MODAL AND NOT A PLACEHOLDER ─────────────────────────────
 *
 * The Description field already has a placeholder, and a placeholder can only
 * ever hold one line. What organisers get wrong is not the sentence, it is the
 * SHAPE: a description that opens with the ticket price and never says what
 * time it ends is missing the five things every attendee asks, and no
 * one-line hint can demonstrate five headings. So the example is the whole
 * thing, at full length, where it can be read next to the field.
 *
 * ── IT DOES NOT OVERWRITE WORK, AND THE BUTTON IS ABSENT WHEN IT WOULD ────
 *
 * "Use this as a starting point" is rendered ONLY while the field is empty.
 * That is a stronger guarantee than disabling it or asking "are you sure":
 * there is no state in which pressing something in this dialog can replace a
 * description somebody wrote. Once there is a single character in the field,
 * the dialog is a reference and nothing else, and it says so.
 *
 * A copy button covers the other half — somebody who wants a paragraph of it
 * takes it to the clipboard and pastes what they want, which is a decision
 * they make in their own field rather than one this dialog makes for them.
 *
 * ── THE EXAMPLE IS ONE SOURCE, RENDERED TWICE ─────────────────────────────
 *
 * `EXAMPLE_SECTIONS` is the only copy of it. The dialog renders it as headed
 * blocks and `exampleText()` flattens the SAME array into the plain text that
 * is inserted or copied, so what somebody reads and what they receive cannot
 * drift — which is exactly what happens when an example is written once for
 * the screen and once for a string constant.
 *
 * The description column is plain text (`toPatchInput` deliberately does not
 * even trim it, to preserve layout), so the flattened form is plain text with
 * blank lines between sections. No markdown: nothing on the event page renders
 * it, and teaching an organiser to type `##` would put literal hashes on a
 * public page.
 */

/**
 * A real description for a real shape of Indian event — a ticketed club night
 * in a city venue.
 *
 * Every line is something an attendee genuinely asks before buying: what it
 * is, who is on, what the ticket covers, how to get there, and what would send
 * them home at the door. The names are invented. Numbers are the kind an
 * organiser fills in, not claims this platform makes.
 */
export const EXAMPLE_SECTIONS: readonly { heading: string; body: string }[] = [
  {
    heading: 'About the night',
    body: 'Monsoon Sessions is back for a fourth year — one room, four acts and a sound system built for it. Doors open at 7pm, the first set starts at 8, and the last one finishes by 11.',
  },
  {
    heading: 'Who is playing',
    body: 'Half Light headline, with sets from Neel & The Static and Anaya B, and an opening hour from the resident DJ. The full running order is further down this page.',
  },
  {
    heading: 'What your ticket includes',
    body: 'Entry, one welcome drink and access to the terrace. Food and the bar are inside and take UPI or card at both counters.',
  },
  {
    heading: 'Getting there',
    body: 'Ten minutes on foot from the metro. Basement parking is paid and limited, so a cab is easier on the way out.',
  },
  {
    heading: 'Good to know',
    body: '18+ with a photo ID. No outside food or drink. The main hall is step-free — ask any steward if you need the lift.',
  },
];

/** The example as the plain text the column actually stores. */
export function exampleText(): string {
  return EXAMPLE_SECTIONS.map((section) => `${section.heading}\n${section.body}`).join('\n\n');
}

export function DescriptionExample({
  /** The current description. Only ever read to decide whether inserting is
   *  offered — this component never receives or holds a draft. */
  value,
  onInsert,
}: {
  value: string;
  onInsert: (text: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const empty = value.trim() === '';

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exampleText());
      setCopied(true);
    } catch {
      // Denied permission, or an insecure origin. The text is on screen and
      // selectable either way, so there is nothing to report and nothing the
      // organiser can do about it — an error toast here would be noise about a
      // convenience that failed.
    }
  };

  return (
    <>
      {/* On the LABEL row, and `ghost`: the wizard spends its one filled pill
          on the step footer's forward action. A help trigger that competed
          with it would be a second claim to be the thing to press. */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-my-1 h-auto px-1.5 py-0.5 text-caption font-normal text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
        leftIcon={<BookOpen className="size-3.5" aria-hidden />}
      >
        See an example
      </Button>

      <Modal open={open} onOpenChange={setOpen}>
        <ModalContent className="max-w-2xl">
          <ModalHeader>
            <ModalTitle>What a good description looks like</ModalTitle>
            <ModalDescription>
              {empty
                ? 'Five headings, in the order people ask about them. Read it, or start from it.'
                : 'Five headings, in the order people ask about them. Nothing here replaces what you have already written.'}
            </ModalDescription>
          </ModalHeader>

          {/* The dialog's own scroller, capped short of the viewport: the header
              and footer are pinned, so a long example can never push its own
              close control or its Insert button off the screen. */}
          <div className="-mx-2 max-h-[55dvh] overflow-y-auto px-2">
            <article className="flex flex-col gap-stack-lg rounded-xl border border-border bg-sunken p-card">
              {EXAMPLE_SECTIONS.map((section) => (
                <section key={section.heading} className="flex flex-col gap-1">
                  {/* h3, because Radix renders the dialog's own title as an h2
                      — an h2 here would sit as a peer of the thing it belongs
                      to in the outline a screen-reader user navigates by. */}
                  <h3 className="text-body-sm font-semibold text-foreground">{section.heading}</h3>
                  <p className="max-w-prose text-body-sm text-muted-foreground">{section.body}</p>
                </section>
              ))}
            </article>
          </div>

          <ModalFooter className="sm:items-center sm:justify-between">
            <p className="text-caption text-muted-foreground">
              {empty
                ? 'Replace every name, time and price with your own.'
                : 'Your description is untouched — this is here to read.'}
            </p>
            <span className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void copy()}
                leftIcon={
                  copied ? (
                    <Check className="size-3.5" aria-hidden />
                  ) : (
                    <Copy className="size-3.5" aria-hidden />
                  )
                }
              >
                {copied ? 'Copied' : 'Copy the text'}
              </Button>
              {/* ABSENT rather than disabled once anything is typed. A disabled
                  control still reads as "this is what you do here", and the one
                  thing this dialog must never do is look like it might replace
                  somebody's description. */}
              {empty ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onInsert(exampleText());
                    setOpen(false);
                  }}
                >
                  Use this as a starting point
                </Button>
              ) : null}
            </span>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
