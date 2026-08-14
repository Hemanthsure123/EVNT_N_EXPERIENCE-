'use client';

import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import {
  MAX_POLICIES,
  POLICY_BODY_MAX,
  POLICY_TITLE_MAX,
  type DraftPolicy,
} from '@/lib/organizer/wizard/model';

/**
 * The organiser's own rules for this event.
 *
 * ── IT IS LOCAL, UNLIKE THE FAQ BUILDER BESIDE IT ─────────────────────────
 *
 * `policies` is a COLUMN on the event, written by the same PATCH as the title
 * and the description, so it saves before the draft exists on the server and
 * needs no "unlocks once saved" panel. FAQs are rows against their own
 * endpoints, which is why that section has one and this does not.
 *
 * ── THE LIST IS WRITTEN WHOLE ─────────────────────────────────────────────
 *
 * There is no per-row save and no id: these entries have no server identity to
 * preserve, so an edit is "here is the new list", never a diff. That is also
 * why removing a row is instant rather than a request — nothing has been
 * written yet.
 *
 * ── A HALF-FILLED ROW IS DROPPED, NOT REFUSED ─────────────────────────────
 *
 * The server rejects a policy with an empty title or body. Blocking the whole
 * save because an organiser opened a row and got distracted would be the wrong
 * trade, so `toUpdateInput` filters them out — a row you did not finish simply
 * does not publish. The count below says how many will.
 */

export function PolicyEditor({
  policies,
  onChange,
}: {
  policies: DraftPolicy[];
  onChange: (next: DraftPolicy[]) => void;
}) {
  const patch = (key: string, changes: Partial<DraftPolicy>) =>
    onChange(policies.map((policy) => (policy.key === key ? { ...policy, ...changes } : policy)));

  const add = () =>
    onChange([
      ...policies,
      // `crypto.randomUUID` is available in every browser this app supports and
      // an index would break as soon as a row above is removed — React would
      // re-key the wrong input and move somebody's text.
      { key: crypto.randomUUID(), title: '', body: '' },
    ]);

  const publishable = policies.filter(
    (policy) => policy.title.trim() && policy.body.trim(),
  ).length;
  const atCap = policies.length >= MAX_POLICIES;

  return (
    <div className="flex flex-col gap-stack-lg">
      {policies.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-sunken p-card text-body-sm text-muted-foreground">
          Entry conditions, prohibited items, your own refund terms, what happens if it
          rains.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {policies.map((policy, index) => {
            const incomplete = Boolean(
              (policy.title.trim() || policy.body.trim()) &&
                !(policy.title.trim() && policy.body.trim()),
            );
            return (
              <li
                key={policy.key}
                className="flex flex-col gap-stack rounded-xl border border-border bg-surface p-card"
              >
                <div className="flex items-start gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <label
                      htmlFor={`${policy.key}-title`}
                      className="text-body-sm font-medium"
                    >
                      Rule {index + 1}
                    </label>
                    <Input
                      id={`${policy.key}-title`}
                      value={policy.title}
                      maxLength={POLICY_TITLE_MAX}
                      onChange={(event) => patch(policy.key, { title: event.target.value })}
                      placeholder="Carry a photo ID"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onChange(policies.filter((entry) => entry.key !== policy.key))}
                    aria-label={`Remove rule ${index + 1}`}
                    className="mt-6 shrink-0 hover:text-destructive"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`${policy.key}-body`} className="sr-only">
                    Details for rule {index + 1}
                  </label>
                  <textarea
                    id={`${policy.key}-body`}
                    value={policy.body}
                    maxLength={POLICY_BODY_MAX}
                    rows={2}
                    onChange={(event) => patch(policy.key, { body: event.target.value })}
                    placeholder="Any government ID matching the name on the booking."
                    className="w-full rounded-md border border-input bg-surface px-3 py-2 text-body text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  />
                  {incomplete ? (
                    // A note, not an error. Nothing is broken and nothing is
                    // blocked — the row simply will not publish, and saying so
                    // is more use than a red field on a form nobody submitted.
                    <p className="text-caption text-muted-foreground">
                      Needs both a name and details to appear on the page.
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          onClick={add}
          disabled={atCap}
          leftIcon={<Plus className="size-4" aria-hidden />}
        >
          Add a rule
        </Button>
        <p className="text-caption text-muted-foreground">
          {atCap
            ? `${MAX_POLICIES} of ${MAX_POLICIES} — that is the limit.`
            : `${publishable} of ${MAX_POLICIES} will appear on the page.`}
        </p>
      </div>
    </div>
  );
}
