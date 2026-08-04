import { describe, expect, it } from 'vitest';
import { emptyDraft, type Draft, type DraftTier } from './model';
import { draftToPreview } from './preview-event';

/**
 * The preview renders the REAL event page, so this mapper decides what the
 * organizer is shown. The cases that matter are the ones where a draft cannot
 * answer and the temptation is to invent something flattering.
 */

const NOW = Date.parse('2026-03-01T10:00:00.000Z');
const LATER = '2026-06-01T19:30';

const tierWith = (over: Partial<DraftTier> = {}): DraftTier => ({
  key: 't1',
  name: 'Gold',
  price: '999',
  quantity: '100',
  maxPerOrder: '10',
  saleStart: '',
  saleEnd: '',
  phases: [],
  ...over,
});

const draftWith = (over: Partial<Draft> = {}): Draft => ({
  ...emptyDraft('org-1'),
  title: 'Jazz night',
  venue: 'Blue Room',
  city: 'Mumbai',
  startsAt: LATER,
  ...over,
});

describe('draftToPreview', () => {
  it('shows nothing as sold, because nothing has been', () => {
    const { tiers } = draftToPreview(draftWith({ tiers: [tierWith()] }), 'Acme', NOW);

    expect(tiers[0]!.sold).toBe(0);
    expect(tiers[0]!.available).toBe(100);
    // Which means no urgency or sold-out badge previews on an unpublished
    // event — the page's own rules decide that from these numbers.
    expect(tiers[0]!.is_on_sale).toBe(true);
  });

  it('derives from_price and tickets_available the way ticketing does', () => {
    const { event } = draftToPreview(
      draftWith({
        tiers: [tierWith(), tierWith({ key: 't2', name: 'Silver', price: '499', quantity: '50' })],
      }),
      'Acme',
      NOW,
    );

    expect(event.from_price).toBe(49_900);
    expect(event.tickets_available).toBe(150);
  });

  it('prices from the active phase, and says what it rises to', () => {
    const { tiers } = draftToPreview(
      draftWith({
        tiers: [
          tierWith({
            phases: [
              { key: 'p1', name: 'Early bird', price: '499', endsAt: '2026-04-01T00:00', quantity: '' },
              { key: 'p2', name: 'Phase 1', price: '799', endsAt: '', quantity: '' },
            ],
          }),
        ],
      }),
      'Acme',
      NOW,
    );

    expect(tiers[0]!.effective_price).toBe(49_900);
    expect(tiers[0]!.current_phase?.name).toBe('Early bird');
    expect(tiers[0]!.next_price).toBe(79_900);
    // Face price is unchanged — it is what the discount is struck through.
    expect(tiers[0]!.price).toBe(99_900);
  });

  it('skips a phase whose deadline has already passed', () => {
    const { tiers } = draftToPreview(
      draftWith({
        tiers: [
          tierWith({
            phases: [
              { key: 'p1', name: 'Early bird', price: '499', endsAt: '2026-01-01T00:00', quantity: '' },
              { key: 'p2', name: 'Phase 1', price: '799', endsAt: '', quantity: '' },
            ],
          }),
        ],
      }),
      'Acme',
      NOW,
    );

    expect(tiers[0]!.current_phase?.name).toBe('Phase 1');
    expect(tiers[0]!.effective_price).toBe(79_900);
  });

  it('reports no active phase, and no next price, for a plain tier', () => {
    const { tiers } = draftToPreview(draftWith({ tiers: [tierWith()] }), 'Acme', NOW);

    expect(tiers[0]!.current_phase).toBeNull();
    // Null, not the face price: there is nothing after the face price, and a
    // number here would render "prices rise to ₹999" against ₹999.
    expect(tiers[0]!.next_price).toBeNull();
    expect(tiers[0]!.effective_price).toBe(tiers[0]!.price);
  });

  it('previews a tier whose sale window has not opened as not on sale', () => {
    const { tiers } = draftToPreview(
      draftWith({ tiers: [tierWith({ saleStart: '2026-05-01T00:00' })] }),
      'Acme',
      NOW,
    );

    expect(tiers[0]!.is_on_sale).toBe(false);
  });

  it('carries no from_price when nothing is sellable', () => {
    const { event } = draftToPreview(
      draftWith({ tiers: [tierWith({ quantity: '0' })] }),
      'Acme',
      NOW,
    );

    // Null, so the page renders its "Pricing soon" branch rather than ₹0.
    expect(event.from_price).toBeNull();
  });

  it('passes empty collections rather than inventing gallery or FAQ content', () => {
    const { content } = draftToPreview(draftWith(), 'Acme', NOW);

    // These live on the server against their own endpoints, so a draft holds
    // none. The page omits each section entirely, which is what a visitor sees.
    expect(content).toEqual({ media: [], faqs: [], timeline: [] });
  });

  it('never previews an unsaved draft as live', () => {
    expect(draftToPreview(draftWith(), 'Acme', NOW).event.status).toBe('unsaved');
    expect(draftToPreview(draftWith({ eventId: 'e1' }), 'Acme', NOW).event.status).toBe('draft');
  });

  it('survives a blank date instead of rendering an invalid one', () => {
    const { event } = draftToPreview(draftWith({ startsAt: '' }), 'Acme', NOW);

    expect(Number.isNaN(Date.parse(event.starts_at))).toBe(false);
    expect(event.ends_at).toBeNull();
  });
});
