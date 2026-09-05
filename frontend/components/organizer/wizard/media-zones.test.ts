import { describe, expect, it } from 'vitest';
import { EVENT_IMAGE } from '@/lib/api/event-content';
import {
  GALLERY_COMBINED_WARN_BYTES,
  GALLERY_UI_CAP,
  IMAGE_ZONES,
  combinedSizeNote,
  cropAdvice,
  zoneFor,
  type ImageZone,
} from './media-zones';

const file = (name = 'poster.jpg') => new File([], name, { type: 'image/jpeg' });
const gallery = IMAGE_ZONES.find((zone) => zone.kind === 'gallery') as ImageZone;
const hero = IMAGE_ZONES.find((zone) => zone.kind === 'hero') as ImageZone;

/**
 * The zones describe SLOTS, and a slot's rules belong to the server.
 *
 * The expensive failure mode here is a zone that advertises something the API
 * refuses — a "portrait poster" dropzone whose every upload comes back 400,
 * or a cap that lets an organiser queue an eleventh gallery photo the server
 * will not take. So every number in the table is checked against the server's.
 */
describe('the zone table agrees with the server', () => {
  it('never advertises a shape outside EVENT_IMAGE_SPEC', () => {
    // `EventContentService.upload_media` runs `validate_image(..., spec=
    // EVENT_IMAGE_SPEC)` for EVERY kind — there is no per-kind spec — so a
    // zone whose target sits outside 1.5–2.0 would be a dropzone that refuses
    // everything it asks for. This is why there is no 3:4 portrait zone.
    for (const zone of IMAGE_ZONES) {
      expect(zone.targetRatio).toBeGreaterThanOrEqual(EVENT_IMAGE.minRatio);
      expect(zone.targetRatio).toBeLessThanOrEqual(EVENT_IMAGE.maxRatio);
    }
  });

  it('never offers more slots than the API accepts', () => {
    // A UI cap ABOVE the server's would let somebody describe and queue a file
    // that can only ever be refused.
    for (const zone of IMAGE_ZONES) {
      expect(zone.uiCap).toBeLessThanOrEqual(zone.serverCap);
    }
  });

  it('mirrors MEDIA_LIMITS: one hero, one mobile, one thumbnail, ten gallery', () => {
    expect(Object.fromEntries(IMAGE_ZONES.map((zone) => [zone.kind, zone.serverCap]))).toEqual({
      hero: 1,
      mobile: 1,
      thumbnail: 1,
      gallery: 10,
    });
  });

  it('marks the gallery cap as a GUIDELINE, because the API allows more', () => {
    // Three is this step's judgement; ten is the rule. Labelling it as a rule
    // would be the UI claiming the server's authority — and would make an
    // event that already holds four look broken rather than merely generous.
    expect(gallery.uiCap).toBe(GALLERY_UI_CAP);
    expect(gallery.capIsGuideline).toBe(true);
    expect(IMAGE_ZONES.filter((zone) => zone.capIsGuideline)).toEqual([gallery]);
  });

  it('has a zone for every non-video kind, so no row can render nowhere', () => {
    for (const kind of ['hero', 'gallery', 'thumbnail', 'mobile'] as const) {
      expect(zoneFor(kind)).not.toBeNull();
    }
    // Video is a link, not an upload — it has its own field.
    expect(zoneFor('video')).toBeNull();
  });
});

describe('cropAdvice', () => {
  it('says nothing when the picture already fits the frame', () => {
    expect(cropAdvice(file(), { width: 1920, height: 1080 }, hero)).toBeNull();
    // A 1920x1081 export is 0.1% off. Mentioning it would train somebody to
    // ignore the line that matters.
    expect(cropAdvice(file(), { width: 1920, height: 1081 }, hero)).toBeNull();
  });

  it('measures what a 3:2 photograph loses to a 16:9 frame', () => {
    const advice = cropAdvice(file('stage.jpg'), { width: 1200, height: 800 }, hero) ?? '';
    expect(advice).toContain('1200 × 800');
    // 1 - (1.5 / 1.7778) = 0.156.
    expect(advice).toContain('16%');
    expect(advice).toContain('the top and bottom');
  });

  it('measures what a 2:1 banner loses, and from the other edges', () => {
    const advice = cropAdvice(file(), { width: 2000, height: 1000 }, hero) ?? '';
    // 1 - (1.7778 / 2) = 0.111.
    expect(advice).toContain('11%');
    expect(advice).toContain('the left and right');
  });

  it('is a warning and says the upload still happens', () => {
    // It must never read as a refusal: the server accepts every one of these,
    // and a client that implies otherwise is overruling the API about somebody
    // else's artwork.
    expect(cropAdvice(file(), { width: 1200, height: 800 }, hero)).toContain('still upload');
  });
});

describe('combinedSizeNote', () => {
  const LIMIT = GALLERY_COMBINED_WARN_BYTES;
  const mb = (value: number) => value * 1024 * 1024;

  it('says nothing about a gallery that is nowhere near it', () => {
    expect(combinedSizeNote(0, 0, LIMIT)).toBeNull();
    expect(combinedSizeNote(mb(1.2), 2, LIMIT)).toBeNull();
  });

  it('speaks up while APPROACHING the limit, not only after it', () => {
    const note = combinedSizeNote(mb(4.2), 3, LIMIT) ?? '';
    expect(note).toContain('4.2 MB');
    expect(note).toContain('close to the 5 MB');
  });

  it('names the per-file limit once over, so the two are not confused', () => {
    // 10 MB per file is the SERVER's rule; 5 MB combined is this step's
    // advice. A sentence that blurred them would look like a refusal.
    const note = combinedSizeNote(mb(7), 4, LIMIT) ?? '';
    expect(note).toContain('7.0 MB');
    expect(note).toContain('10 MB the server allows');
  });
});
