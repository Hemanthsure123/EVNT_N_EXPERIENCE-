'use client';

import * as React from 'react';
import { FileText } from 'lucide-react';
import type { EventFaq } from '@/lib/api/event-content';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { cn } from '@/lib/utils/cn';

/**
 * Help — the questions somebody has at the moment they are deciding to buy.
 *
 * ── IT REUSES THE DESIGN SYSTEM'S ACCORDION, AND THAT IS THE ANIMATION ────
 *
 * `components/ui/accordion` animates on `grid-template-rows: 0fr -> 1fr`. That
 * is the technique worth keeping: it animates to the content's REAL height
 * with no measuring, no `scrollHeight` read, no ResizeObserver and no jump when
 * the content reflows — which is exactly the "expand without jumping" this
 * section was asked for. A Framer Motion `height: auto` would do the same job
 * by measuring, and a second implementation of a control this app already has
 * is a second set of focus and `aria-expanded` bugs.
 *
 * ── WHAT IT ANSWERS, AND WHAT IT REFUSES TO INVENT ───────────────────────
 *
 * The organiser's own FAQs come first, verbatim and in their order — they are
 * the ones about THIS event. Under them sit a few platform answers, and every
 * one of them is a statement this codebase can actually stand behind:
 *
 *   · tickets are a signed QR in the account, because `booking` issues exactly
 *     that and `checkin` scans it;
 *   · a cancelled event refunds automatically, because `payments` does;
 *   · the refund terms are the ORGANISER'S, which is why that answer sends you
 *     to their policies rather than stating a window we do not set.
 *
 * There is deliberately no "contact support" answer with a channel behind it:
 * there is no support inbox in this system, and a help section whose first
 * suggestion is a dead end is worse than one that stops where the facts do.
 */

type HelpEntry = { id: string; question: string; answer: React.ReactNode };

/**
 * The platform's own answers.
 *
 * A module constant rather than props: these are true of every event on the
 * platform, and threading them through the page would invite one screen to
 * answer differently from another.
 */
const PLATFORM_HELP: HelpEntry[] = [
  {
    id: 'help-tickets',
    question: 'How do I get my tickets?',
    answer:
      'They are issued the moment your payment is confirmed and live in your account under My tickets — each one a QR code that is scanned at the gate. There is nothing to print and nothing to collect.',
  },
  {
    id: 'help-entry',
    question: 'What do I show at the door?',
    answer:
      'Open the ticket in your account and show the QR code. Each code admits one person once, so everyone coming needs their own ticket on their own screen.',
  },
  {
    id: 'help-cancelled',
    question: 'What happens if the event is cancelled?',
    answer:
      'If the organiser cancels, every paid ticket is refunded automatically — you do not need to ask. The refund goes back to the method you paid with.',
  },
  {
    id: 'help-refund',
    question: 'Can I get a refund or change my booking?',
    answer:
      'Refund terms are set by the organiser rather than by us, and they are written out in this event’s policies. Open Policies below to read the ones that apply here.',
  },
];

export function HelpSection({
  faqs,
  onOpenPolicies,
  className,
}: {
  /** The organiser's own questions about THIS event, in their order. */
  faqs: EventFaq[];
  onOpenPolicies: () => void;
  className?: string;
}) {
  const entries: HelpEntry[] = [
    ...faqs.map((faq) => ({
      id: `faq-${faq.id}`,
      question: faq.question,
      // `whitespace-pre-line`: organisers write these in a textarea and their
      // paragraph breaks are part of the answer.
      answer: <span className="whitespace-pre-line">{faq.answer}</span>,
    })),
    ...PLATFORM_HELP,
  ];

  return (
    <section id="event-help" className={cn('flex scroll-mt-16 flex-col gap-3', className)}>
      <h3 className="text-h4 text-foreground">Help</h3>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        {/* `multiple`, not `single`: somebody comparing the refund answer with
            the entry answer should not have the first one close under them. */}
        <Accordion type="multiple" className="flex flex-col">
          {entries.map((entry, index) => (
            <AccordionItem
              key={entry.id}
              value={entry.id}
              className={cn('px-4', index > 0 && 'border-t border-border')}
            >
              <AccordionTrigger className="py-4 text-left text-body-sm font-semibold text-foreground">
                {entry.question}
              </AccordionTrigger>
              <AccordionContent className="pb-4 text-body-sm leading-relaxed text-muted-foreground">
                {entry.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>

      {/* The organiser's policies stay a SHEET rather than a fifth accordion
          row. They are a long-form document — refunds, entry, age, conduct —
          and unrolling one inside a list of one-paragraph answers buries the
          answers around it. */}
      <button
        type="button"
        onClick={onOpenPolicies}
        className="flex items-center gap-3.5 rounded-2xl border border-border bg-surface p-4 text-left transition-colors active:bg-muted"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <FileText className="size-5" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-body-sm font-semibold text-foreground">
            Policies
          </span>
          <span className="truncate text-caption text-muted-foreground">
            Refunds, entry and age limits
          </span>
        </span>
      </button>
    </section>
  );
}
