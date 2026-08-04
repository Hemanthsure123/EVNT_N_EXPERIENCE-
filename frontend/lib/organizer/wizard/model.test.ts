import { describe, expect, it } from 'vitest';
import {
  SEO_TITLE_MAX,
  UNSAVED_DRAFT_BLOCKER,
  canCreate,
  completion,
  draftStorageKey,
  emptyDraft,
  newTier,
  patchFingerprint,
  priceSummary,
  publishBlockers,
  resolveOrganizationId,
  restoreDraft,
  tierFingerprint,
  toCreateInput,
  toPatchInput,
  toTierInput,
  validate,
  type Draft,
  type DraftTier,
} from './model';

const NOW = new Date('2026-07-28T00:00:00Z');
const FUTURE = '2026-12-01T19:00';
const PAST = '2026-01-01T19:00';

function draftWith(patch: Partial<Draft> = {}): Draft {
  return {
    ...emptyDraft('org-1'),
    title: 'Summer Sessions',
    venue: 'Phoenix Arena',
    city: 'Mumbai',
    startsAt: FUTURE,
    ...patch,
  };
}

function tierWith(patch: Partial<DraftTier> = {}): DraftTier {
  return { ...newTier(0), name: 'Gold', price: '499', quantity: '100', ...patch };
}

describe('validate', () => {
  it('accepts a complete draft', () => {
    expect(validate(draftWith(), NOW)).toEqual([]);
  });

  it('requires the fields POST /events requires', () => {
    const issues = validate(emptyDraft('org-1'), NOW);
    const fields = issues.map((issue) => issue.field);
    expect(fields).toContain('title');
    expect(fields).toContain('venue');
    expect(fields).toContain('city');
    expect(fields).toContain('startsAt');
  });

  it('rejects a start time in the past, exactly as the serializer does', () => {
    const issues = validate(draftWith({ startsAt: PAST }), NOW);
    expect(issues.find((issue) => issue.field === 'startsAt')?.message).toMatch(/future/);
  });

  it('rejects an end before the start', () => {
    const issues = validate(draftWith({ endsAt: '2026-11-30T19:00' }), NOW);
    expect(issues.find((issue) => issue.field === 'endsAt')?.message).toMatch(/after the start/);
  });

  it('accepts a free ticket but not a negative one', () => {
    expect(validate(draftWith({ tiers: [tierWith({ price: '0' })] }), NOW)).toEqual([]);
    const issues = validate(draftWith({ tiers: [tierWith({ price: '-1' })] }), NOW);
    expect(issues).toHaveLength(1);
  });

  it('requires a quantity of at least one', () => {
    const issues = validate(draftWith({ tiers: [tierWith({ quantity: '0' })] }), NOW);
    expect(issues[0].message).toMatch(/at least 1/);
  });

  it('rejects a sale window that ends before it starts', () => {
    const issues = validate(
      draftWith({
        tiers: [tierWith({ saleStart: '2026-11-01T10:00', saleEnd: '2026-10-01T10:00' })],
      }),
      NOW,
    );
    expect(issues[0].message).toMatch(/end after they start/);
  });
});

/**
 * The bug this suite exists for.
 *
 * `POST /events` refuses an organisation the caller does not own with "Only
 * the owning organization can manage this event." Two client-side paths led
 * there: a STALE id restored from a draft another account left in the shared
 * `localStorage` key, and an EMPTY id captured by a `useState` initialiser
 * that ran before `GET /organizations/` answered. Both are resolved here, in
 * pure code, so neither can come back without a red test.
 */
describe('resolveOrganizationId', () => {
  it('keeps an id the account actually owns', () => {
    expect(resolveOrganizationId('org-2', ['org-1', 'org-2'])).toBe('org-2');
  });

  it('drops a STALE id — the one the backend refuses', () => {
    // Left behind by another account on a shared browser, or an organisation
    // handed over since. Sending it is the 403; dropping it is not.
    expect(resolveOrganizationId('someone-elses-org', ['org-1', 'org-2'])).toBe('');
    expect(resolveOrganizationId('someone-elses-org', [])).toBe('');
  });

  it('adopts the only organisation when there is exactly one', () => {
    // The EMPTY-id path: the wizard was seeded before the list arrived, so the
    // draft could never be created. There is nothing to choose between here.
    expect(resolveOrganizationId('', ['org-1'])).toBe('org-1');
    expect(resolveOrganizationId('stale', ['org-1'])).toBe('org-1');
  });

  it('refuses to GUESS when several are owned', () => {
    // Picking the first would attach the event, its revenue and its payouts to
    // whichever company sorted first. Empty means "ask", and `canCreate` holds.
    expect(resolveOrganizationId('', ['org-1', 'org-2'])).toBe('');
  });

  it('leaves an empty id empty when the account owns none', () => {
    expect(resolveOrganizationId('', [])).toBe('');
  });
});

describe('restoreDraft', () => {
  it('re-resolves the stored organisation rather than trusting it', () => {
    const restored = restoreDraft({ title: 'Kept', organizationId: 'foreign-org' }, ['org-1']);
    expect(restored.organizationId).toBe('org-1');
    // The typed content survives — only the id the API would refuse is replaced.
    expect(restored.title).toBe('Kept');
  });

  it('leaves the organisation unset when the stale id cannot be replaced', () => {
    const restored = restoreDraft({ title: 'Kept', organizationId: 'foreign-org' }, [
      'org-1',
      'org-2',
    ]);
    expect(restored.organizationId).toBe('');
    expect(restored.title).toBe('Kept');
    expect(canCreate(restored)).toBe(false);
  });

  it('fills in an organisation a draft was saved without', () => {
    const restored = restoreDraft({ title: 'Kept', organizationId: '' }, ['org-1']);
    expect(restored.organizationId).toBe('org-1');
  });

  it('DISCARDS a draft already created under an organisation this account does not own', () => {
    // `organization_id` is set at POST and is not in the PATCH body, so
    // repointing would leave every autosave patching an event this account
    // cannot touch. Starting clean is the recoverable outcome.
    const restored = restoreDraft(
      { eventId: 'evt-1', version: 4, title: 'Not mine', organizationId: 'foreign-org' },
      ['org-1'],
    );
    expect(restored.eventId).toBeNull();
    expect(restored.title).toBe('');
    expect(restored.organizationId).toBe('org-1');
  });

  it('keeps a created draft whose organisation is still owned', () => {
    const restored = restoreDraft(
      { eventId: 'evt-1', version: 4, title: 'Mine', organizationId: 'org-1' },
      ['org-1', 'org-2'],
    );
    expect(restored.eventId).toBe('evt-1');
    expect(restored.version).toBe(4);
  });

  it('merges onto a fresh draft, so a draft from an older build cannot crash a step', () => {
    const restored = restoreDraft({ title: 'Old build', organizationId: 'org-1' }, ['org-1']);
    expect(restored.shortDescription).toBe('');
    expect(restored.tiers).toEqual([]);
    // A draft stored before the venue picker existed has none of the pin
    // fields. They have to come back as the empty pair rather than `undefined`:
    // `latitude: undefined` reaches `toPatchInput` as a missing key, which the
    // serializer reads as "leave it alone", and the pin section would render a
    // marker at `undefined`.
    expect(restored.placeId).toBe('');
    expect(restored.latitude).toBeNull();
    expect(restored.longitude).toBeNull();
    // A hand-corrupted `tiers` is coerced rather than trusted.
    expect(
      restoreDraft({ organizationId: 'org-1', tiers: 'nonsense' as unknown as [] }, ['org-1'])
        .tiers,
    ).toEqual([]);
  });

  it('returns a usable empty draft when there is nothing stored', () => {
    expect(restoreDraft(null, ['org-1'])).toEqual(emptyDraft('org-1'));
    expect(restoreDraft(undefined, [])).toEqual(emptyDraft(''));
  });
});

describe('draftStorageKey', () => {
  it('is namespaced per account, so a shared browser cannot leak a draft', () => {
    expect(draftStorageKey('user-a')).not.toBe(draftStorageKey('user-b'));
    // And no longer the global key whose drafts crossed accounts.
    expect(draftStorageKey('user-a')).not.toBe('ee-event-draft-v1');
  });
});

describe('publishBlockers', () => {
  it('mirrors the backend publish gate: needs a saved event and a tier', () => {
    expect(publishBlockers(draftWith())).toEqual([
      UNSAVED_DRAFT_BLOCKER,
      'Add at least one ticket type.',
    ]);
  });

  it('exports the unsaved blocker by name, so Review can attach the CAUSE to it', () => {
    // Review matches on this exact string to append the live save state (the
    // actual error, the missing field, or offline) and a Save now button —
    // renaming it here without Review noticing would quietly bring back the
    // dead end where the fact rendered without its cause.
    expect(publishBlockers(draftWith())).toContain(UNSAVED_DRAFT_BLOCKER);
    expect(publishBlockers(draftWith({ eventId: 'evt-1' }))).not.toContain(UNSAVED_DRAFT_BLOCKER);
  });

  it('clears once the event and its tier exist on the server', () => {
    const draft = draftWith({
      eventId: 'evt-1',
      tiers: [tierWith({ serverId: 'tt-1', version: 1 })],
    });
    expect(publishBlockers(draft)).toEqual([]);
  });

  it('still blocks while a tier is only local', () => {
    const draft = draftWith({ eventId: 'evt-1', tiers: [tierWith()] });
    expect(publishBlockers(draft)).toContain('One or more ticket types have not saved yet.');
  });
});

describe('canCreate', () => {
  it('is false until everything POST /events needs is present', () => {
    expect(canCreate(emptyDraft('org-1'))).toBe(false);
    expect(canCreate(draftWith({ city: '' }))).toBe(false);
    expect(canCreate(draftWith({ organizationId: '' }))).toBe(false);
  });

  it('is false for a past start, which the API would reject anyway', () => {
    expect(canCreate(draftWith({ startsAt: PAST }))).toBe(false);
  });

  it('is true once the required set is complete', () => {
    expect(canCreate(draftWith())).toBe(true);
  });

  it('says WHY a draft with no organisation is not saving', () => {
    // Without this the wizard just stopped: `canCreate` false, the badge
    // reading "Saved on this device", and nothing on screen explaining it.
    const issue = validate(draftWith({ organizationId: '' }), NOW).find(
      (candidate) => candidate.field === 'organizationId',
    );
    expect(issue?.message).toMatch(/organisation/i);
    // Attributed to Basics, which is where the picker is, so the rail marks
    // the step that can fix it and the Review list jumps there.
    expect(issue?.step).toBe('basics');
  });

  it('raises no organisation issue once one is resolved', () => {
    expect(validate(draftWith(), NOW)).toEqual([]);
  });
});

describe('API mapping', () => {
  it('sends null rather than an empty string for an absent end time', () => {
    expect(toCreateInput(draftWith()).ends_at).toBeNull();
  });

  it('converts rupees in the field to paise on the wire', () => {
    // The single most expensive unit bug available on this screen: ₹499
    // becoming ₹4.99, or ₹49,900.
    expect(toTierInput(tierWith({ price: '499' })).price).toBe(49_900);
    expect(toTierInput(tierWith({ price: '2499.50' })).price).toBe(249_950);
    expect(toTierInput(tierWith({ price: '0' })).price).toBe(0);
  });

  it('defaults max per order rather than sending NaN', () => {
    expect(toTierInput(tierWith({ maxPerOrder: '' })).max_per_order).toBe(10);
  });

  it('sends the pricing schedule in array order, in paise', () => {
    // The phase price is what a buyer is CHARGED once the schedule is live, so
    // it takes the same rupees-to-paise conversion as the face price — and the
    // array order is the position the backend stores.
    const input = toTierInput(
      tierWith({
        price: '999',
        phases: [
          { key: 'a', name: 'Early bird', price: '499', endsAt: '2026-09-01T10:00', quantity: '' },
          { key: 'b', name: 'Phase 1', price: '699.50', endsAt: '', quantity: '250' },
        ],
      }),
    );

    expect(input.phases).toEqual([
      {
        name: 'Early bird',
        price: 49_900,
        // A `datetime-local` value is the organizer's WALL CLOCK, so it is
        // interpreted in their timezone — computed here the same way rather
        // than hardcoded, or this test would only pass in one timezone.
        ends_at: new Date('2026-09-01T10:00').toISOString(),
        quantity: null,
      },
      { name: 'Phase 1', price: 69_950, ends_at: null, quantity: 250 },
    ]);
  });

  it('omits the schedule entirely when there are no phases', () => {
    // Not `[]`: an absent key leaves an existing schedule alone, while an empty
    // array would read as "clear it" on a tier that never had one.
    expect('phases' in toTierInput(tierWith({ phases: [] }))).toBe(false);
  });

  it('includes the schedule in the tier fingerprint', () => {
    // Without this, a typed discount never triggers a PATCH: the badge appears
    // in the preview and the tier on the server keeps its old price.
    const plain = tierWith({ phases: [] });
    const scheduled = tierWith({
      phases: [{ key: 'a', name: 'Early bird', price: '499', endsAt: '', quantity: '100' }],
    });
    expect(tierFingerprint(plain)).not.toBe(tierFingerprint(scheduled));

    // And editing a phase's price is a change the save engine can see.
    const repriced = tierWith({
      phases: [{ key: 'a', name: 'Early bird', price: '449', endsAt: '', quantity: '100' }],
    });
    expect(tierFingerprint(scheduled)).not.toBe(tierFingerprint(repriced));

    // The React list key is NOT part of it — re-keying identical phases is not
    // an edit worth a write.
    const rekeyed = tierWith({
      phases: [{ key: 'zzz', name: 'Early bird', price: '499', endsAt: '', quantity: '100' }],
    });
    expect(tierFingerprint(scheduled)).toBe(tierFingerprint(rekeyed));
  });
});

describe('priceSummary', () => {
  it('reports nulls rather than zeros when there are no tiers', () => {
    const summary = priceSummary([]);
    expect(summary.lowestMinor).toBeNull();
    expect(summary.highestMinor).toBeNull();
    expect(summary.capacity).toBe(0);
  });

  it('computes the range, average, capacity and gross potential', () => {
    const summary = priceSummary([
      tierWith({ price: '499', quantity: '100' }),
      tierWith({ price: '999', quantity: '50' }),
    ]);
    expect(summary.lowestMinor).toBe(49_900);
    expect(summary.highestMinor).toBe(99_900);
    // Quantity-weighted: (49_900×100 + 99_900×50) / 150, not the midpoint of
    // the two tier labels.
    expect(summary.averageMinor).toBe(Math.round((49_900 * 100 + 99_900 * 50) / 150));
    expect(summary.capacity).toBe(150);
    expect(summary.potentialMinor).toBe(49_900 * 100 + 99_900 * 50);
  });

  it('weights the average by quantity, so a rare expensive tier cannot dominate', () => {
    // Ten gold at ₹999 over nine hundred and ninety basic at ₹99: the average
    // TICKET costs ~₹108. The old unweighted mean said ₹549 — a number no
    // attendee would ever pay.
    const summary = priceSummary([
      tierWith({ price: '999', quantity: '10' }),
      tierWith({ price: '99', quantity: '990' }),
    ]);
    expect(summary.averageMinor).toBe(Math.round((99_900 * 10 + 9_900 * 990) / 1000));
  });

  it('reports a null average while no tier has a quantity', () => {
    // 0/0 is not an average; the preview renders an em dash for null.
    const summary = priceSummary([tierWith({ price: '499', quantity: '' })]);
    expect(summary.averageMinor).toBeNull();
    expect(summary.lowestMinor).toBe(49_900);
  });
});

describe('completion', () => {
  it('is 0 for an empty draft and 100 once every field is filled', () => {
    expect(completion(emptyDraft(''))).toBe(0);
    expect(completion(draftWith({ tiers: [tierWith()], posterUrl: 'blob:x' }))).toBe(100);
  });
});

describe('content fields', () => {
  it('treats every one as optional', () => {
    // An event with no age policy, no stated language and no duration is a
    // complete event. Requiring them is how a made-up value gets published.
    expect(validate(draftWith(), NOW)).toEqual([]);
  });

  it('flags copy longer than the column allows', () => {
    const issues = validate(draftWith({ seoTitle: 'x'.repeat(SEO_TITLE_MAX + 1) }), NOW);
    expect(issues.map((issue) => issue.field)).toContain('seoTitle');
    // Attributed to the step that owns the field, so the rail marks the right
    // one red.
    expect(issues.find((issue) => issue.field === 'seoTitle')?.step).toBe('seo');
  });

  it('rejects a duration that is not a whole positive number of minutes', () => {
    for (const durationMinutes of ['0', '-5', '1.5', 'soon']) {
      const issues = validate(draftWith({ durationMinutes }), NOW);
      expect(issues.map((issue) => issue.field)).toContain('durationMinutes');
    }
  });

  it('accepts a blank duration as "not stated"', () => {
    expect(validate(draftWith({ durationMinutes: '' }), NOW)).toEqual([]);
  });
});

describe('toPatchInput', () => {
  it('sends an empty content field rather than omitting it', () => {
    // This is what makes CLEARING work. A missing key means "leave it alone"
    // to the serializer, so omitting blanks would make a deleted age
    // restriction reappear on the next reload.
    const patch = toPatchInput(draftWith({ ageRestriction: '' }));
    expect(patch).toHaveProperty('age_restriction', '');
    expect(patch).toHaveProperty('seo_title', '');
  });

  it('maps a blank duration to null, never to 0', () => {
    // `duration_minutes: 0` would render as "0 minutes", which is a claim.
    expect(toPatchInput(draftWith({ durationMinutes: '' })).duration_minutes).toBeNull();
    expect(toPatchInput(draftWith({ durationMinutes: '180' })).duration_minutes).toBe(180);
  });

  it('trims the content fields but leaves the description alone', () => {
    const patch = toPatchInput(
      draftWith({ shortDescription: '  Four stages.  ', description: '  Keep\n  layout  ' }),
    );
    expect(patch.short_description).toBe('Four stages.');
    expect(patch.description).toBe('  Keep\n  layout  ');
  });

  it('carries the version the client last read, for the optimistic lock', () => {
    expect(toPatchInput(draftWith({ version: 7 })).version).toBe(7);
  });
});

/**
 * The venue's place and pin.
 *
 * Two ways to get these wrong, both expensive. Omitting them from the PATCH
 * leaves a removed pin on the public event page forever; sending HALF a pair is
 * a 400 on EVERY autosave of that draft, with the organizer's only escape being
 * to clear their browser storage.
 */
describe('the venue pin', () => {
  const PINNED = { placeId: 'ChIJ-abc', latitude: 19.076, longitude: 72.8777 };

  it('sends the place and both coordinates on create', () => {
    const input = toCreateInput(draftWith(PINNED));
    expect(input.place_id).toBe('ChIJ-abc');
    expect(input.latitude).toBe(19.076);
    expect(input.longitude).toBe(72.8777);
  });

  it('CLEARS all three together, rather than omitting them', () => {
    // Removing a pin has to be a value the serializer can act on. A missing key
    // means "leave it alone", so the map on the public page would keep pointing
    // at the place the organizer just deleted.
    const patch = toPatchInput(draftWith({ placeId: '', latitude: null, longitude: null }));
    expect(patch).toHaveProperty('place_id', '');
    expect(patch).toHaveProperty('latitude', null);
    expect(patch).toHaveProperty('longitude', null);
  });

  it('normalises HALF a pair to neither, because the serializer 400s a lone value', () => {
    // Unreachable through the pickers, which only ever write the pair — but a
    // hand-edited `localStorage`, or a draft from a build that stored one of
    // them, can hold half. `_validate_coordinate_pair` refuses it.
    for (const half of [{ latitude: 19.076 }, { longitude: 72.8777 }]) {
      const patch = toPatchInput(draftWith(half));
      expect(patch.latitude).toBeNull();
      expect(patch.longitude).toBeNull();
    }
  });

  it('rounds to the 7 decimal places the column holds', () => {
    // `DecimalField(decimal_places=7)` refuses more digits than that, and a
    // rejected PATCH is every subsequent autosave failing too.
    const patch = toPatchInput(draftWith({ latitude: 19.07609876543, longitude: -72.87771234567 }));
    expect(patch.latitude).toBe(19.0760988);
    expect(patch.longitude).toBe(-72.8777123);
  });
});

describe('patchFingerprint', () => {
  it('changes when a content field changes, so autosave actually fires', () => {
    const before = draftWith();
    expect(patchFingerprint({ ...before, ageRestriction: '18+' })).not.toBe(
      patchFingerprint(before),
    );
  });

  it('includes the pin, or dragging the marker would never save', () => {
    // The save engine fires a PATCH only when this string moves. With the pin
    // left out, a dropped or dragged marker changed nothing it could see: the
    // draft held coordinates the server was never told about, and the event page
    // showed no map with no error anywhere.
    const before = draftWith();
    expect(patchFingerprint({ ...before, latitude: 19.076, longitude: 72.8777 })).not.toBe(
      patchFingerprint(before),
    );
    expect(patchFingerprint({ ...before, placeId: 'ChIJ-abc' })).not.toBe(patchFingerprint(before));
    // And clearing one moves it back, so removing a pin saves too.
    const pinned = draftWith({ placeId: 'ChIJ-abc', latitude: 19.076, longitude: 72.8777 });
    expect(patchFingerprint({ ...pinned, placeId: '', latitude: null, longitude: null })).toBe(
      patchFingerprint(before),
    );
  });

  it('ignores fields that are not part of the PATCH', () => {
    // A tier edit has its own fingerprint and its own endpoint; counting it
    // here would queue a pointless event PATCH on every tier keystroke.
    const before = draftWith();
    expect(patchFingerprint({ ...before, tiers: [tierWith()] })).toBe(patchFingerprint(before));
  });
});
