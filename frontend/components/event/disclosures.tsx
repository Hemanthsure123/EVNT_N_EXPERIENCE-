'use client';

import * as React from 'react';
import { DetailSheet, DisclosureList, DisclosureRow } from '@/components/event/detail-sheet';

/**
 * The event page's tertiary information, as rows that open sheets.
 *
 * ── WHY THE CONTENT ARRIVES AS A PROP ─────────────────────────────────────
 *
 * `event-page-body.tsx` is a SERVER component and every section this hides —
 * the fact grid, the organiser card, the venue card, the running order, the
 * FAQ list, the policy set — renders fine on the server. Only the open/closed
 * state needs a browser.
 *
 * So the sections are rendered by the server and handed here as `content`
 * nodes. The alternative, importing them into a client component, would drag
 * all six plus their icon and formatting dependencies into the client bundle
 * to gain nothing: none of them are interactive. This is the children-as-props
 * boundary, and on this page it is worth being deliberate about, because the
 * event page is the most-visited authenticated-optional route on the platform.
 *
 * ── ONE OPEN AT A TIME ────────────────────────────────────────────────────
 *
 * A single `openKey`, not six booleans. Six booleans permit two sheets open at
 * once, which Radix will happily render as two stacked focus traps — and the
 * second Escape then closes the wrong one. It also means a row can hand over
 * to another row later (a "see the venue" link inside the organiser sheet)
 * without any of them having to know about the others' state.
 */

export interface Disclosure {
  key: string;
  /** A RENDERED element, never a component reference — see `DisclosureRow`. */
  icon?: React.ReactNode;
  /** The row's label AND the sheet's title — they must match, or the sheet
   *  reads as though it opened the wrong thing. */
  label: string;
  /** The glanceable summary on the row. See `DisclosureRow`. */
  value?: React.ReactNode;
  /** One line under the sheet's title. Optional. */
  description?: string;
  content: React.ReactNode;
  size?: 'md' | 'lg';
}

export function EventDisclosures({ items }: { items: Disclosure[] }) {
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const active = items.find((item) => item.key === openKey) ?? null;

  return (
    <>
      <DisclosureList>
        {items.map((item) => (
          <DisclosureRow
            key={item.key}
            icon={item.icon}
            label={item.label}
            value={item.value}
            onClick={() => setOpenKey(item.key)}
          />
        ))}
      </DisclosureList>

      {/* ONE sheet, keyed by the active row.
          The `key` matters: without it React reuses the same instance across
          two different disclosures, so opening Venue after Organiser would
          keep the previous sheet's scroll position — the reader lands
          halfway down content they have not seen. */}
      <DetailSheet
        key={active?.key ?? 'none'}
        open={active !== null}
        onOpenChange={(next) => {
          if (!next) setOpenKey(null);
        }}
        title={active?.label ?? ''}
        description={active?.description}
        size={active?.size}
      >
        {active?.content}
      </DetailSheet>
    </>
  );
}
