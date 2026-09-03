import type { EventContent } from '@/lib/api/event-content';
import type { EventDetail, SalePhase, TicketTier } from '@/lib/api/types';
import type { Draft, DraftPhase, DraftTier } from './model';

/**
 * The draft, shaped as the API would return it — so the Studio's preview can
 * render the REAL event page rather than an approximation of it.
 *
 * ── WHY A MAPPER AND NOT A SECOND LAYOUT ──────────────────────────────────
 *
 * `components/event/event-page-body.tsx` takes an `EventDetail`, its tiers and
 * its content. Give it those three from local state and the organizer sees the
 * page a visitor will see, down to the sold-out badge and the empty-section
 * rules. The alternative — a hand-drawn preview — is what this replaced, and
 * it had already drifted from the page it claimed to show.
 *
 * ── WHERE THE DRAFT CANNOT ANSWER, IT DOES NOT INVENT ─────────────────────
 *
 * A local draft has no server-side truth for several fields, and each is
 * filled with the value that makes the page render HONESTLY rather than
 * flatteringly:
 *
 *   - `sold` is 0 and `available` is the full quantity. Nothing has been sold,
 *     which is true of an unpublished event, so urgency and sold-out badges
 *     stay off unless the organizer themselves set a tier to zero capacity.
 *   - `is_on_sale` follows the tier's own sale window when it has one, exactly
 *     as the backend computes it — so a tier whose sale has not opened previews
 *     as not-yet-on-sale instead of bookable.
 *   - `tickets_available` / `from_price` are DERIVED here from the draft's
 *     tiers, mirroring what `ticketing` writes back to the event row on save.
 *   - ids are the draft's client-side keys. They are never sent anywhere: the
 *     preview's panel does not fetch and its buy button is inert.
 */

const toMinor = (rupees: string): number => Math.round(Number(rupees || 0) * 100);

/** A `datetime-local` string as an ISO instant, or null. Blank stays null so
 *  the page's "no end time" branch renders, rather than an Invalid Date. */
function toIso(local: string): string | null {
  if (!local) return null;
  const at = new Date(local);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

function toPhase(phase: DraftPhase, index: number): SalePhase {
  return {
    id: phase.key,
    name: phase.name.trim() || `Phase ${index + 1}`,
    price: toMinor(phase.price),
    ends_at: toIso(phase.endsAt),
    quantity: phase.quantity === '' ? null : Number(phase.quantity),
    position: index,
  };
}

/**
 * The same rule `ticketing.pricing` applies under the row lock: the first
 * phase, in order, that has not passed its deadline and has not exhausted its
 * cumulative seat threshold. Nothing is sold in a draft, so only the deadline
 * can rule a phase out here.
 */
function activePhase(phases: SalePhase[], now: number): SalePhase | null {
  return (
    phases.find((phase) => {
      const live = phase.ends_at === null || new Date(phase.ends_at).getTime() > now;
      const roomy = phase.quantity === null || phase.quantity > 0;
      return live && roomy;
    }) ?? null
  );
}

export function draftTierToTicketTier(tier: DraftTier, eventId: string, now: number): TicketTier {
  const price = toMinor(tier.price);
  const quantity = Number(tier.quantity) || 0;
  const phases = tier.phases.map(toPhase);
  const current = activePhase(phases, now);
  const startsOk = !tier.saleStart || new Date(tier.saleStart).getTime() <= now;
  const endsOk = !tier.saleEnd || new Date(tier.saleEnd).getTime() > now;

  return {
    id: tier.serverId ?? tier.key,
    event_id: eventId,
    // The wizard's tier form has no session field yet (sessions are a
    // step of their own and only exist once the draft is saved), so a
    // previewed tier belongs to no session — which is the honest shape
    // for a draft and renders the panel exactly as a single-show event.
    slot_id: null,
    name: tier.name.trim() || 'Ticket',
    description: tier.description.trim(),
    perks: tier.perks.map((perk) => perk.trim()).filter(Boolean),
    position: 0,
    price,
    effective_price: current ? current.price : price,
    current_phase: current
      ? {
          name: current.name,
          ends_at: current.ends_at,
          // A draft has sold nothing, so a capped phase has its whole
          // allowance left. Null (uncapped) stays null — the panel renders
          // "only N left" ONLY from a real number.
          remaining: current.quantity,
        }
      : null,
    next_price: current ? (phases[phases.indexOf(current) + 1]?.price ?? price) : null,
    phases,
    quantity,
    sold: 0,
    available: quantity,
    sale_start: toIso(tier.saleStart),
    sale_end: toIso(tier.saleEnd),
    max_per_order: Number(tier.maxPerOrder) || 10,
    is_on_sale: startsOk && endsOk && quantity > 0,
    version: tier.version ?? 1,
    created_at: new Date(now).toISOString(),
  };
}

export function draftToPreview(
  draft: Draft,
  organizationName: string,
  /** Injected so a render is deterministic and testable — and so the preview
   *  and the phase badge it draws agree on "now". */
  now: number = Date.now(),
): { event: EventDetail; tiers: TicketTier[]; content: EventContent } {
  const eventId = draft.eventId ?? 'preview';
  const tiers = draft.tiers.map((tier) => draftTierToTicketTier(tier, eventId, now));
  const sellable = tiers.filter((tier) => tier.is_on_sale);

  const event: EventDetail = {
    id: eventId,
    title: draft.title.trim() || 'Untitled event',
    venue: draft.venue,
    city: draft.city,
    // The organiser's own choice, so the preview's chip is the one the
    // browse tile will show rather than a blank.
    category: draft.category,
    place_id: draft.placeId,
    latitude: draft.latitude,
    longitude: draft.longitude,
    // The page needs an instant to format. An unset date previews as now,
    // which is the least misleading placeholder — the Review step is what
    // refuses to publish without a real future start.
    starts_at: toIso(draft.startsAt) ?? new Date(now).toISOString(),
    poster_url: draft.posterUrl,
    // Derived exactly as `ticketing` derives the denormalised columns it
    // writes back after a save: cheapest sellable price, total remaining.
    from_price: sellable.length ? Math.min(...sellable.map((tier) => tier.effective_price)) : null,
    tickets_available: tiers.length
      ? tiers.reduce((total, tier) => total + tier.available, 0)
      : null,
    organization_id: draft.organizationId,
    organization_name: organizationName,
    description: draft.description,
    ends_at: toIso(draft.endsAt),
    // It is a draft, and the preview says so rather than claiming `live`.
    status: draft.eventId ? 'draft' : 'unsaved',
    version: draft.version,
    created_at: new Date(now).toISOString(),
    short_description: draft.shortDescription,
    duration_minutes: draft.durationMinutes === '' ? null : Number(draft.durationMinutes),
    language: draft.language,
    age_restriction: draft.ageRestriction,
    accessibility_notes: draft.accessibilityNotes,
    // Blank rows dropped, exactly as the save does — so the preview shows what
    // would actually be published rather than what is on screen.
    policies: draft.policies
      .map((policy) => ({ title: policy.title.trim(), body: policy.body.trim() }))
      .filter((policy) => policy.title && policy.body),
    seo_title: draft.seoTitle,
    seo_description: draft.seoDescription,
  };

  /**
   * Gallery, FAQs and the running order live on the SERVER (they are edited
   * against their own endpoints once the draft exists), so the draft holds
   * none of them. The preview passes empty collections and the page's own
   * "render only what the organiser supplied" rules do the rest — the
   * sections simply do not appear, which is exactly what a visitor would see.
   * The cover image still previews, because it rides `poster_url` on the draft.
   */
  const content: EventContent = { media: [], faqs: [], timeline: [], slots: [], crew: [] };

  return { event, tiers, content };
}
