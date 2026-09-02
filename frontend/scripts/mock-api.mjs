/**
 * FIXTURE BACKEND — speaks the real `GET /api/v1/events` contract, byte for byte.
 *
 * Why this exists: the discovery layer is wired to the REAL backend (see
 * backend/apps/events/api.py). But the real backend needs Postgres + PgBouncer +
 * TLS Redis via docker compose, which CI doesn't have and a laptop may not have
 * running. So this dependency-free Node server reproduces exactly the contract
 * the app consumes:
 *
 *   GET /api/v1/events?q&city&starts_after&starts_before&cursor&page_size
 *        -> { data: [EventCard], meta: { next, previous } }
 *        -> Cache-Control: public, max-age=15, s-maxage=30, stale-while-revalidate=30
 *        -> ETag + 304 on If-None-Match          (mirrors core/http_caching.py)
 *   GET /api/v1/events/{id}   -> EventDetail, max-age=30, s-maxage=60, swr=30
 *   GET /media/posters/{n}.png -> a real PNG (so next/image optimisation and
 *                                 LCP measurement are honest, not a stub)
 *   GET /health/               -> {"status":"ok"}
 *
 * It listens on the SAME port the real backend uses (8000), so NOTHING in the
 * app or its config is fixture-aware: you either run docker compose, or you run
 * this. Start it with `npm run mock:api`.
 */

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const PORT = Number(process.env.MOCK_API_PORT ?? 8000);
const ORIGIN = process.env.MOCK_API_ORIGIN ?? `http://localhost:${PORT}`;

/* -------------------------------------------------------------------------- */
/* Deterministic PRNG — same fixture every run, so E2E assertions are stable.  */
/* -------------------------------------------------------------------------- */

function makeRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];

/* -------------------------------------------------------------------------- */
/* PNG encoder — ~40 lines, no dependencies. Real bytes beat a placeholder.    */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encode an RGB image from a (x, y) -> [r,g,b] sampler. */
function encodePng(width, height, sample) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    raw[row] = 0; // filter type: none
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = sample(x, y);
      const o = row + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/*
 * SYNTHETIC EVENT PHOTOGRAPHY.
 *
 * The real product shows organizer-uploaded posters. A fixture can't ship
 * licensed concert photography, but flat two-stop gradients made the hero's
 * cinematic treatment impossible to evaluate — you can't judge a scrim, a
 * vignette or bloom against a smooth ramp.
 *
 * So each poster is composed the way a stage photograph is: a dark base, two or
 * three coloured key lights with quadratic bloom falloff, soft beams cast down
 * from them, a crowd silhouette along the bottom edge, a vignette, and film
 * grain. It is still generated, but it has the tonal range (bright speculars,
 * deep shadows, a dark lower third for text) that the design has to survive.
 */

// Key-light colours per category. Two or three lights, warm/cool paired.
const PALETTES = [
  [
    [168, 85, 247],
    [236, 72, 153],
    [59, 130, 246],
  ], // concerts
  [
    [236, 72, 153],
    [245, 158, 11],
    [217, 70, 160],
  ], // comedy
  [
    [59, 130, 246],
    [139, 92, 246],
    [34, 211, 238],
  ], // workshops
  [
    [34, 197, 94],
    [59, 130, 246],
    [163, 230, 53],
  ], // sports
  [
    [236, 72, 153],
    [251, 146, 60],
    [168, 85, 247],
  ], // festivals
  [
    [139, 92, 246],
    [219, 39, 119],
    [56, 189, 248],
  ], // nightlife
  [
    [251, 146, 60],
    [239, 68, 68],
    [252, 211, 77],
  ], // food
  [
    [99, 102, 241],
    [56, 189, 248],
    [168, 85, 247],
  ], // tech
];

const POSTER_W = 960;
const POSTER_H = 640;

/** Deterministic value noise — same grain every run, so bytes are stable. */
function grainAt(x, y) {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

function buildPoster(lights, seed) {
  const rnd = makeRandom(seed);
  // Two or three key lights in the upper two-thirds.
  const sources = lights.map((colour) => ({
    colour,
    x: 0.16 + rnd() * 0.68,
    y: 0.12 + rnd() * 0.34,
    power: 1.15 + rnd() * 0.75,
    radius: 0.17 + rnd() * 0.16,
    beam: 0.5 + rnd() * 0.5,
  }));
  // Crowd silhouette: a few overlapping heads along the bottom edge.
  const heads = Array.from({ length: 26 }, () => ({
    x: rnd(),
    r: 0.026 + rnd() * 0.034,
    y: 0.86 + rnd() * 0.1,
  }));

  return encodePng(POSTER_W, POSTER_H, (px, py) => {
    const x = px / POSTER_W;
    const y = py / POSTER_H;

    // Base: near-black navy, lifting very slightly toward the top.
    let r = 14 + (1 - y) * 16;
    let g = 18 + (1 - y) * 19;
    let b = 34 + (1 - y) * 32;

    for (const light of sources) {
      const dx = x - light.x;
      const dy = y - light.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Bloom: quadratic falloff, so the core blows out and the halo is wide.
      const bloom = Math.max(0, 1 - dist / light.radius) ** 2.2 * light.power;
      // A wide, faint haze around each source so the beams sit in atmosphere.
      const haze = Math.max(0, 1 - dist / (light.radius * 4)) ** 2 * light.power * 0.26;

      // Beam: a soft cone widening downward from the source.
      const below = y - light.y;
      const spread = 0.05 + below * 0.42;
      const beam =
        below > 0
          ? Math.max(0, 1 - Math.abs(dx) / spread) ** 2 *
            Math.max(0, 1 - below / 0.95) *
            0.5 *
            light.beam
          : 0;

      const energy = bloom + haze + beam;
      r += light.colour[0] * energy;
      g += light.colour[1] * energy;
      b += light.colour[2] * energy;
    }

    // Crowd silhouette along the bottom — pure shadow, never a colour.
    let crowd = y > 0.72 ? (y - 0.72) / 0.28 : 0;
    for (const head of heads) {
      const dx = (x - head.x) / head.r;
      const dy = (y - head.y) / (head.r * 1.5);
      if (dx * dx + dy * dy < 1) crowd = 1;
    }
    const shade = 1 - Math.min(1, crowd) * 0.92;
    r *= shade;
    g *= shade;
    b *= shade;

    // Vignette.
    const vx = (x - 0.5) * 1.35;
    const vy = (y - 0.45) * 1.25;
    const vignette = 1 - Math.min(1, (vx * vx + vy * vy) * 0.85) * 0.55;
    r *= vignette;
    g *= vignette;
    b *= vignette;

    // Film grain.
    //
    // Amplitude matters for more than looks. Chrome excludes images below
    // ~0.05 bits/pixel from LCP entirely, treating them as placeholders — and a
    // smooth synthetic gradient optimises so well that the hero on the event
    // page landed at 0.046 bpp and was skipped, handing LCP to whatever text
    // painted last. Real photography is never that compressible, so grain here
    // keeps the fixture's optimised output in the same range and local Web
    // Vitals measurements stay representative instead of pathological.
    const grain = (grainAt(px, py) - 0.5) * 26;
    return [
      Math.max(0, Math.min(255, Math.round(r + grain))),
      Math.max(0, Math.min(255, Math.round(g + grain))),
      Math.max(0, Math.min(255, Math.round(b + grain))),
    ];
  });
}

const POSTERS = PALETTES.map((lights, i) => buildPoster(lights, 7919 + i * 104729));

/** ASCII slug, matching `django.utils.text.slugify` closely enough for a
 *  fixture: lowercase, non-alphanumerics collapsed to single hyphens. */
function slugify(text) {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

/* -------------------------------------------------------------------------- */
/* Fixture events                                                             */
/* -------------------------------------------------------------------------- */

const CITIES = [
  'Mumbai',
  'Bengaluru',
  'Delhi',
  'Hyderabad',
  'Pune',
  'Chennai',
  'Kolkata',
  'Goa',
  'Jaipur',
  'Ahmedabad',
];

const CATEGORY_SEEDS = [
  {
    posterIndex: 0,
    titles: [
      'Arijit Singh Live in Concert',
      'The Local Train — Unplugged',
      'Prateek Kuhad: The Silhouettes Tour',
      'Sunburn Arena ft. Alan Walker',
      'Indian Ocean Live',
      'Symphony Under the Stars',
    ],
    venues: ['NSCI Dome', 'Phoenix Marketcity Grounds', 'Jawaharlal Nehru Stadium'],
    orgs: ['BookMyShow Live', 'Sunburn', 'Paytm Insider'],
    keyword: 'concert live music',
  },
  {
    posterIndex: 1,
    titles: [
      'Zakir Khan: Papa Yaar',
      'Comedy Night with Kanan Gill',
      'Anubhav Singh Bassi — Bas Kar Bassi',
      'Open Mic Comedy Showcase',
      'Improv Comedy Jam',
    ],
    venues: ['The Habitat', 'Canvas Laugh Club', 'Studio Xo Bar'],
    orgs: ['OML', 'Canvas Laugh Club', 'Habitat Studio'],
    keyword: 'comedy standup',
  },
  {
    posterIndex: 2,
    titles: [
      'Pottery Workshop: Wheel Throwing Basics',
      'Watercolour Journaling Masterclass',
      'Film Photography Workshop',
      'Sourdough Baking Workshop',
      'Creative Writing Intensive',
    ],
    venues: ['The Creative Loft', 'Studio Alcove', 'Maker Space HSR'],
    orgs: ['Craft Collective', 'Studio Alcove', 'Maker Space'],
    keyword: 'workshop masterclass',
  },
  {
    posterIndex: 3,
    titles: [
      'Premier League Screening: Derby Night',
      'City Marathon 2026',
      'Pro Kabaddi League — Home Leg',
      'Sunday Football League Finals',
      'Padel Open Championship',
    ],
    venues: ['DY Patil Stadium', 'Kanteerava Stadium', 'Sports Arena Whitefield'],
    orgs: ['Sportz Interactive', 'City Sports Trust', 'Arena Events'],
    keyword: 'sports match tournament',
  },
  {
    posterIndex: 4,
    titles: [
      'Lollapalooza India — Day 1',
      'Kala Ghoda Arts Festival',
      'Ziro Valley Music Festival',
      'Holi Colour Festival',
      'Rann Utsav Cultural Festival',
    ],
    venues: ['Mahalaxmi Race Course', 'Kala Ghoda Precinct', 'Embassy Riding School'],
    orgs: ['BookMyShow Live', 'Festival Collective', 'Paytm Insider'],
    keyword: 'festival',
  },
  {
    posterIndex: 5,
    titles: [
      'Techno Nights ft. Anyasa',
      'Rooftop Sundowner Session',
      'Bollywood Night: Retro Edition',
      'Deep House Sessions',
      'Afterhours: Warehouse Rave',
    ],
    venues: ['Kitty Su', 'AntiSocial', 'Bay 146'],
    orgs: ['Nightlife Collective', 'AntiSocial', 'Kitty Su'],
    keyword: 'nightlife party dj',
  },
  {
    posterIndex: 6,
    titles: [
      'The Grape Escape: Wine Tasting',
      'Street Food Carnival',
      "Chef's Table: Coastal Kitchen",
      'Craft Beer Festival',
      'Coffee Cupping Session',
    ],
    venues: ['Sula Vineyards', 'Jio World Garden', 'The Tasting Room'],
    orgs: ['Sula Vineyards', 'Food Collective', 'Brewhouse Events'],
    keyword: 'food drink tasting',
  },
  {
    posterIndex: 7,
    titles: [
      'React India Conference',
      'AI Builders Summit',
      'Startup Pitch Night',
      'Design Systems Meetup',
      'Cloud Native Day',
    ],
    venues: ['Bombay Exhibition Centre', 'Taj Yeshwantpur', 'WeWork Galaxy'],
    orgs: ['React India', 'Tech Collective', 'Startup Grind'],
    keyword: 'tech conference meetup',
  },
];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const IST_OFFSET_MS = 5.5 * HOUR;

/** Doors-open slots people actually buy tickets for, in IST. */
const SHOW_SLOTS = [11, 15, 18, 19.5, 20, 21];

/**
 * Snap an instant to a plausible IST show time on that day. Real events start
 * in the evening, not at 03:12 — and a fixture that looks wrong makes every
 * screenshot of the UI look wrong too.
 */
function showTime(instant, rnd) {
  const slot = SHOW_SLOTS[Math.floor(rnd() * SHOW_SLOTS.length)];
  const istMidnight = Math.floor((instant + IST_OFFSET_MS) / DAY) * DAY - IST_OFFSET_MS;
  let start = istMidnight + slot * HOUR;
  // Never in the past: roll forward a day at a time until it's ahead of now.
  while (start <= Date.now() + HOUR) start += DAY;
  return new Date(start);
}

/** UUID-shaped deterministic ids (the real backend uses UUID primary keys). */
function fixtureId(n) {
  const h = createHash('sha1').update(`event-${n}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Built fresh on every request-batch boundary so "Today"/"This weekend" always
 * have results no matter when the fixture is started.
 */
function buildEvents() {
  const rnd = makeRandom(20260725);
  const now = Date.now();
  const events = [];
  let n = 0;

  // Offsets deliberately cover: later today, tomorrow, the coming weekend, and
  // the next six weeks — so every date chip has something to show.
  const offsets = [
    4 * HOUR,
    8 * HOUR,
    1 * DAY,
    2 * DAY,
    3 * DAY,
    4 * DAY,
    5 * DAY,
    6 * DAY,
    9 * DAY,
    12 * DAY,
    16 * DAY,
    21 * DAY,
    28 * DAY,
    35 * DAY,
    42 * DAY,
  ];

  for (const seed of CATEGORY_SEEDS) {
    for (const title of seed.titles) {
      for (let copy = 0; copy < 2; copy += 1) {
        const startsAt = showTime(now + offsets[n % offsets.length], rnd);
        // Price ladder incl. free events and a few unpriced (ticketing hasn't
        // populated the denormal yet) — exactly the nulls the real API returns.
        const priceRoll = rnd();
        let fromPrice = null;
        if (priceRoll < 0.12) fromPrice = 0;
        else if (priceRoll < 0.45) fromPrice = pick(rnd, [19900, 29900, 34900, 49900]);
        else if (priceRoll < 0.85) fromPrice = pick(rnd, [59900, 79900, 99900, 149900]);
        else if (priceRoll < 0.95) fromPrice = pick(rnd, [249900, 349900]);

        // Availability ladder: sold out / few left / selling fast / plenty.
        const availRoll = rnd();
        let ticketsAvailable = null;
        if (availRoll < 0.08) ticketsAvailable = 0;
        else if (availRoll < 0.22) ticketsAvailable = 1 + Math.floor(rnd() * 8);
        else if (availRoll < 0.45) ticketsAvailable = 12 + Math.floor(rnd() * 35);
        else if (availRoll < 0.92) ticketsAvailable = 120 + Math.floor(rnd() * 900);

        const org = pick(rnd, seed.orgs);
        const eventTitle = copy === 0 ? title : `${title} — ${pick(rnd, CITIES)} Edition`;
        events.push({
          id: fixtureId(n),
          // Mirrors `backend/apps/events/slugs.event_slug`: the readable half
          // of `/events/{slug}-{id}`. The fixture has to carry it or the e2e
          // suite exercises the bare-uuid fallback and never the real URL.
          slug: slugify(eventTitle),
          title: eventTitle,
          // Sent as null/0 by the real serializer, never omitted: `null` means
          // NOBODY HAS REVIEWED, which the card renders as no badge at all
          // rather than as a terrible score.
          rating: null,
          rating_count: 0,
          venue: pick(rnd, seed.venues),
          city: pick(rnd, CITIES),
          starts_at: startsAt.toISOString(),
          ends_at: new Date(startsAt.getTime() + 3 * HOUR).toISOString(),
          description: `An unmissable ${seed.keyword} night presented by ${org}, live and in full. Doors open an hour before showtime; entry is a single QR scan at the gate.`,
          category: seed.category ?? '',
          poster_url: `${ORIGIN}/media/posters/${seed.posterIndex}.png`,
          from_price: fromPrice,
          tickets_available: ticketsAvailable,
          organization_id: fixtureId(1000 + seed.posterIndex),
          organization_name: org,
          _posterIndex: seed.posterIndex,
        });
        n += 1;
      }
    }
  }

  events.sort((a, b) => (a.starts_at < b.starts_at ? -1 : a.starts_at > b.starts_at ? 1 : 0));
  return events;
}

/* -------------------------------------------------------------------------- */
/* Ticket tiers — mirrors apps/ticketing TicketTypeSerializer                  */
/* -------------------------------------------------------------------------- */

/**
 * Three tiers per event, derived from the event's own `from_price` and
 * `tickets_available` so the detail page and the card can never disagree:
 * the cheapest tier's price IS `from_price`, and the tiers' remaining stock
 * sums to `tickets_available`. That's exactly the invariant the real backend
 * maintains — `ticketing` writes both denormals onto the event row from the
 * authoritative tier rows.
 */
const TIER_SHAPE = [
  { name: 'Basic', multiplier: 1, share: 0.55 },
  { name: 'Gold', multiplier: 2.2, share: 0.3 },
  { name: 'Premium', multiplier: 4, share: 0.15 },
];

/**
 * Sale phases: ONE event has a live one, everything else is at face price.
 *
 * The frontend has two states to render and they are not symmetrical — "no
 * phase" is every tier on the platform and "a phase is running" is the one that
 * strikes a price through, badges a name, counts seats and starts a clock. So
 * exactly one fixture event carries it, deterministically, and it is the
 * CHEAPEST tier of that event: an active phase on a higher tier could reorder
 * what a buyer sees as cheapest, and a fixture is not the place to make an
 * ordering assertion depend on a discount.
 *
 * Everything a real tier payload carries is carried here in the same shape —
 * `effective_price` equal to `price` and `current_phase: null` when nothing is
 * running, because that IS what the serializer sends (they are not omitted), and
 * a component that only ever meets the phase-shaped fixture is a component that
 * has never been rendered against the normal case.
 */
/** ~2 days out, quantised to the hour so a restart does not move it. */
const PHASE_ENDS_AT = new Date(Math.ceil((Date.now() + 2 * DAY) / HOUR) * HOUR).toISOString();
const PHASE_NAME = 'Early bird';
/** Seats still inside the phase's CUMULATIVE cap, before any live holds. Set
 *  rather than null on purpose: "Only N left at this price" renders only from a
 *  real number, so the fixture has to supply one to exercise that line at all. */
const PHASE_HEADROOM = 18;

/**
 * Which event carries the schedule — chosen by predicate, memoised.
 *
 * Not a hard-coded index: `from_price` and `tickets_available` come off the
 * seeded random ladder, so index 2 might be a free event, an unpriced one or one
 * with four tickets left, and a phase on any of those exercises nothing. The
 * predicate ("priced, and with real stock") is just as deterministic and cannot
 * pick a degenerate event.
 */
let phasedEventId;
function phasedEvent() {
  if (phasedEventId === undefined) {
    const candidate = buildEvents().find(
      (event) => event.from_price > 0 && (event.tickets_available ?? 0) > 200,
    );
    phasedEventId = candidate?.id ?? '';
  }
  return phasedEventId;
}

function buildTiers(event) {
  const rnd = makeRandom(Number.parseInt(event.id.slice(-8), 16) || 7);
  // Unpriced events have no tiers at all — that's what a null `from_price`
  // means on the real API (ticketing hasn't written the denormal yet).
  if (event.from_price === null || event.tickets_available === null) return [];

  const base = event.from_price;
  const remaining = event.tickets_available;
  let leftToAllocate = remaining;

  return TIER_SHAPE.map((tier, index) => {
    const last = index === TIER_SHAPE.length - 1;
    const nominal = last ? leftToAllocate : Math.round(remaining * tier.share);
    leftToAllocate -= nominal;
    // A plausible sell-through, so `sold` is a real number the page can add up.
    const sold = Math.round(nominal * (0.6 + rnd() * 2.4)) + (last ? 0 : 5);
    const quantity = nominal + sold;
    const id = fixtureId(9000 + index * 137 + (Number.parseInt(event.id.slice(-4), 16) % 500));
    const held = reservedByTier.get(id) ?? 0;
    // Live availability = the nominal stock minus whatever bookings hold.
    const available = Math.max(nominal - held, 0);
    const price = Math.round((base * tier.multiplier) / 100) * 100;
    return {
      id,
      event_id: event.id,
      // The fixture events all run once, so no tier belongs to a session. Sent
      // rather than omitted because the real serializer always sends it, and a
      // fixture whose shape differs from the API is a fixture that hides bugs.
      slot_id: null,
      // The real serializer always sends these three; a fixture whose shape
      // differs from the API is a fixture that hides bugs.
      description: '',
      perks: [],
      position: 0,
      name: tier.name,
      price,
      // The three phase fields the real serializer always sends, computed by the
      // same rule it uses (`apps/ticketing/pricing.py`): no schedule, or one
      // that has lapsed, means `effective_price === price`, `current_phase: null`
      // and `next_price: null` — there is nothing after the face price.
      ...phaseFields({ event, index, price, sold, held }),
      quantity,
      sold,
      available,
      sale_start: null,
      sale_end: null,
      max_per_order: 10,
      is_on_sale: available > 0,
      version: 1,
      created_at: new Date(Date.now() - 30 * DAY).toISOString(),
    };
  });
}

/**
 * The `effective_price` / `current_phase` / `next_price` / `phases` block.
 *
 * Only the CHEAPEST tier of the one phased event gets a schedule, and the
 * cumulative cap is expressed the way the real column is: `sold + headroom`,
 * counting every seat already sold or held. So booking against the fixture walks
 * the count down and eventually exhausts the phase, exactly as it would in
 * production — which is the only way the "phase lapsed" branch ever gets
 * rendered without editing the fixture.
 */
function phaseFields({ event, index, price, sold, held }) {
  if (index !== 0 || event.id !== phasedEvent()) {
    return { effective_price: price, current_phase: null, next_price: null, phases: [] };
  }
  // 20% off, rounded to whole rupees like every other price here.
  const phasePrice = Math.round((price * 0.8) / 100) * 100;
  const cap = sold + PHASE_HEADROOM;
  const remaining = Math.max(0, cap - (sold + held));
  const live = remaining > 0 && Date.parse(PHASE_ENDS_AT) > Date.now();
  const phase = {
    id: fixtureId(9500 + index),
    name: PHASE_NAME,
    price: phasePrice,
    ends_at: PHASE_ENDS_AT,
    quantity: cap,
    position: 0,
  };
  return {
    effective_price: live ? phasePrice : price,
    current_phase: live ? { name: PHASE_NAME, ends_at: PHASE_ENDS_AT, remaining } : null,
    // The face price is what comes next — there is no later phase.
    next_price: live ? price : null,
    // The schedule is still reported once it has lapsed: the rows exist, and the
    // organizer's own editor reads them.
    phases: [phase],
  };
}

/**
 * What ONE unit of an order of this size is billed, and the phase that priced it
 * — the fixture's copy of `decide_unit_price`, including the STRADDLE rule: an
 * order that does not fit inside the phase's remaining seats pays the next price
 * for the WHOLE order, never a split one. Without it the fixture would quote a
 * discount the real backend refuses, which is the one thing a money-path fixture
 * must not do.
 */
function billFor(tier, quantity) {
  const phase = tier.current_phase;
  if (!phase || (phase.remaining !== null && quantity > phase.remaining)) {
    return { unit_price: tier.price, phase_name: null };
  }
  return { unit_price: tier.effective_price, phase_name: phase.name };
}

/* -------------------------------------------------------------------------- */
/* Accounts + bookings — mirrors apps/accounts and apps/booking                */
/* -------------------------------------------------------------------------- */

/**
 * In-memory users and bookings. Deliberately NOT persisted: the fixture's whole
 * point is that every run starts from the same known state, and a booking that
 * survived a restart would make "reserve the last two tickets" a test you can
 * only run once.
 *
 * The token is a signed-looking opaque string, not a real JWT. Nothing in the
 * frontend parses it — `token-store` treats it as bytes and the backend is the
 * only thing that ever validates one — so minting a real JWT here would add a
 * dependency to prove something no code checks.
 */
const users = new Map(); // email -> { id, email, full_name, password, tokens }
const sessions = new Map(); // access token -> email
const bookings = new Map(); // id -> booking
const idempotency = new Map(); // `${email}:${key}` -> booking id
/**
 * Tickets held by bookings, per tier.
 *
 * Without this the fixture would happily "reserve" without inventory ever
 * moving, which is the one behaviour the real backend most needs to be
 * faithful about — a reserve takes a per-tier row lock and decrements
 * availability. A fixture that skips it lets an oversell bug pass every test.
 */
const reservedByTier = new Map(); // tier id -> quantity held

/**
 * Matches backend `PLATFORM_FEE_BPS`. 100 bps = 1% of the ticket subtotal,
 * ADDED to what the customer pays rather than deducted from the organizer's
 * share. Integer arithmetic rounded half up, exactly as Python does it — a
 * fixture that rounds differently from the backend produces a total the funnel
 * displays and the webhook would then reject.
 */
const PLATFORM_FEE_BPS = 100;
const platformFeeFor = (subtotal) => Math.floor((subtotal * PLATFORM_FEE_BPS + 5_000) / 10_000);
/** Matches backend DONATION_MAX_MINOR. */
const DONATION_MAX_MINOR = 100_000;
/**
 * Matches backend BOOKING_HOLD_MINUTES.
 *
 * Overridable so the EXPIRY path can actually be exercised. Ten minutes of
 * real waiting per attempt is why that branch had never been run: it was
 * asserted in code and never once observed, and it turned out to leave a live
 * Pay button beside a band saying the tickets were released.
 * `MOCK_HOLD_SECONDS=20` makes it a twenty-second wait instead.
 */
const HOLD_MINUTES = 10;
const HOLD_MS = process.env.MOCK_HOLD_SECONDS
  ? Number(process.env.MOCK_HOLD_SECONDS) * 1_000
  : HOLD_MINUTES * 60_000;

function issueTokens(email) {
  const access = `fixture.${Buffer.from(email).toString('base64url')}.${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  sessions.set(access, email);
  return { access, refresh: `refresh.${access}` };
}

function userPayload(user) {
  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    // A real nullable column (`User.phone`), and the booking review renders it.
    // Absent from this payload, a number saved through the details sheet
    // disappeared on the next read — which looks exactly like a failed save.
    phone: user.phone ?? '',
    is_organizer: false,
    // Matches `UserSerializer` — the operator console and the header's account
    // menu both branch on it. Granted here only to an address that asks for it
    // explicitly (`someone+staff@example.com`), so no ordinary fixture account
    // can drift into being an operator by accident.
    is_staff: user.email.includes('+staff@'),
    date_joined: user.date_joined,
  };
}

function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const email = sessions.get(token);
  return email ? (users.get(email) ?? null) : null;
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const authError = (res, req, status, code, message, details = {}) =>
  sendJson(req, res, status, { error: { code, message, details } });

/* -------------------------------------------------------------------------- */
/* Query handling — mirrors EventRepository.list_published                    */
/* -------------------------------------------------------------------------- */

const CARD_FIELDS = [
  'id',
  'slug',
  'rating',
  'rating_count',
  'title',
  'venue',
  'city',
  'starts_at',
  'category',
  'poster_url',
  'from_price',
  'tickets_available',
  'organization_id',
  'organization_name',
];

/**
 * EVERY field `EventDetailSerializer` sends — not a subset.
 *
 * It used to be fourteen of them, and the omissions were not harmless. The
 * event page reads `event.policies.length`, and an ABSENT `policies` (rather
 * than the empty list the real API always sends) threw
 * `Cannot read properties of undefined` during render, which collapsed the
 * whole event page to the not-found boundary — on every event, in every
 * production-build run. A fixture that sends less than the contract does not
 * merely under-test; it makes the app look broken in ways it is not.
 *
 * Blank/null defaults are supplied by `withDetailDefaults` below, because the
 * real serializer never omits a field: "the organizer did not say" is `""` or
 * `null` on the wire, and the frontend distinguishes that from missing.
 */
/**
 * Gallery, FAQs and running order for one event.
 *
 * Deterministic by INDEX, not random: an e2e spec has to be able to say "the
 * second event has a gallery and the first does not" and have that be true on
 * every run. Odd indices carry content, even ones carry none — so both the
 * populated and the genuinely-empty branch are reachable from a fixed URL.
 *
 * Gallery images reuse the fixture's own generated posters, so they are real
 * PNGs that `next/image` can optimise rather than external URLs a test machine
 * may not be able to reach.
 */
function buildContent(event, index, all) {
  if (index % 2 === 0) {
    return { media: [], faqs: [], timeline: [], slots: [] };
  }

  const neighbours = [all[(index + 1) % all.length], all[(index + 2) % all.length]];
  const start = Date.parse(event.starts_at);

  return {
    media: [
      {
        id: fixtureId(41000 + index),
        kind: 'gallery',
        url: event.poster_url,
        alt_text: `${event.title} on stage`,
        caption: '',
        position: 0,
      },
      ...neighbours.map((other, n) => ({
        id: fixtureId(41100 + index * 7 + n),
        kind: 'gallery',
        url: other.poster_url,
        alt_text: `The crowd at ${event.venue}`,
        caption: '',
        position: n + 1,
      })),
    ],
    faqs: [
      {
        id: fixtureId(42000 + index),
        question: 'Is there parking at the venue?',
        answer: `Paid parking is available beside ${event.venue}. Spaces are limited on busy nights.`,
        position: 0,
      },
      {
        id: fixtureId(42100 + index),
        question: 'Can I re-enter after leaving?',
        answer: 'Re-entry is not permitted once you have been scanned in.',
        position: 1,
      },
    ],
    timeline: [
      {
        id: fixtureId(43000 + index),
        kind: 'doors',
        label: 'Doors open',
        description: '',
        starts_at: new Date(start - 45 * 60_000).toISOString(),
        position: 0,
      },
      {
        id: fixtureId(43100 + index),
        kind: 'main',
        label: 'Main set',
        description: '',
        starts_at: event.starts_at,
        position: 1,
      },
    ],
    slots: [],
  };
}

const DETAIL_FIELDS = [
  'id',
  'slug',
  'organization_id',
  'organization_name',
  'organization_verified',
  'title',
  'description',
  'venue',
  'city',
  'category',
  'place_id',
  'latitude',
  'longitude',
  'starts_at',
  'ends_at',
  'status',
  'poster_url',
  'from_price',
  'tickets_available',
  'rating',
  'rating_count',
  'version',
  'created_at',
  'short_description',
  'duration_minutes',
  'language',
  'age_restriction',
  'accessibility_notes',
  'policies',
  'seo_title',
  'seo_description',
];

/** The blank/null values the real serializer sends for anything unset. */
const DETAIL_DEFAULTS = {
  organization_verified: false,
  place_id: '',
  latitude: null,
  longitude: null,
  status: 'live',
  rating: null,
  rating_count: 0,
  version: 1,
  short_description: '',
  duration_minutes: null,
  language: '',
  age_restriction: '',
  accessibility_notes: '',
  // ALWAYS a list, never undefined — this is the field whose absence broke the
  // event page.
  policies: [],
  seo_title: '',
  seo_description: '',
};

const project = (event, fields) => Object.fromEntries(fields.map((f) => [f, event[f]]));

/** Loose stand-in for Postgres websearch tsquery: every term must appear. */
function matchesSearch(event, q) {
  const haystack = `${event.title} ${event.venue} ${event.city} ${event.description}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

function filterEvents(all, params) {
  const now = Date.now();
  const q = params.get('q');
  const city = params.get('city');
  const after = params.get('starts_after');
  const before = params.get('starts_before');
  const lowerBound = after ? Date.parse(after) : now;
  const upperBound = before ? Date.parse(before) : null;

  return all.filter((e) => {
    const t = Date.parse(e.starts_at);
    if (t < lowerBound) return false;
    if (upperBound !== null && t > upperBound) return false;
    if (city && e.city.toLowerCase() !== city.toLowerCase()) return false;
    if (q && !matchesSearch(e, q)) return false;
    return true;
  });
}

const encodeCursor = (offset) => Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
function decodeCursor(cursor) {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return Number.isInteger(parsed.o) ? parsed.o : 0;
  } catch {
    return 0;
  }
}

const etagFor = (body) => `"${createHash('md5').update(JSON.stringify(body)).digest('hex')}"`;

/* -------------------------------------------------------------------------- */
/* Server                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The create-booking response, matching apps/booking/api.py: the booking plus a
 * payment block carrying the order id and the PUBLIC Razorpay key.
 *
 * `key_id` is empty here exactly as it is on a default backend (`RAZORPAY_KEY_ID`
 * defaults to "" and `PAYMENTS_BACKEND=fake`). That is on purpose: the frontend
 * has to have a defined, honest behaviour when no live key is configured, and
 * the fixture is where that path gets exercised.
 */
function bookingResponse(booking) {
  // `items` is deliberately STRIPPED. The real `POST /bookings` returns
  // `BookingSummarySerializer`, which has no line items — only
  // `GET /bookings/{id}` (BookingDetailSerializer) does. An earlier version of
  // this fixture included them, and that single inaccuracy hid a real bug: the
  // review screen rendered an empty ticket list against the actual backend
  // while looking perfect locally. A fixture that is kinder than the contract
  // is worse than no fixture.
  const { user_email: _ignored, items: _items, ...summary } = booking;
  return {
    booking: summary,
    payment: {
      order_id: booking.payment_order_id,
      amount_minor: booking.total_amount,
      currency: 'INR',
      key_id: process.env.MOCK_RAZORPAY_KEY_ID ?? '',
    },
  };
}

function sendJson(req, res, status, body, cacheControl) {
  const payload = JSON.stringify(body);
  const headers = {
    'Content-Type': 'application/json',
    // The real backend sits behind CORS for the Next dev server.
    'Access-Control-Allow-Origin': '*',
    // `Idempotency-Key` MUST be listed. A browser will not send a header the
    // preflight did not allow, and the request never leaves — which looks
    // like a network failure, not a CORS one. The real backend needs the same
    // entry in `CORS_ALLOW_HEADERS`; django-cors-headers' defaults omit it.
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, Idempotency-Key',
    'Access-Control-Expose-Headers': 'ETag',
  };
  if (cacheControl) {
    const etag = etagFor(body);
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ...headers, ETag: etag, 'Cache-Control': cacheControl });
      res.end();
      return;
    }
    headers.ETag = etag;
    headers['Cache-Control'] = cacheControl;
  }
  res.writeHead(status, headers);
  res.end(payload);
}

const LIST_CACHE_CONTROL = 'public, max-age=15, s-maxage=30, stale-while-revalidate=30';
const DETAIL_CACHE_CONTROL = 'public, max-age=30, s-maxage=60, stale-while-revalidate=30';
/** Mirrors apps/ticketing/api.py: max-age 5, s-maxage 5, swr 10. */
const TIERS_CACHE_CONTROL = 'public, max-age=5, s-maxage=5, stale-while-revalidate=10';

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', ORIGIN);
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      // `Idempotency-Key` MUST be listed. A browser will not send a header the
      // preflight did not allow, and the request never leaves — which looks
      // like a network failure, not a CORS one. The real backend needs the same
      // entry in `CORS_ALLOW_HEADERS`; django-cors-headers' defaults omit it.
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, Idempotency-Key',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    });
    res.end();
    return;
  }

  // A marker only THIS server answers. Playwright's `reuseExistingServer`
  // probes it rather than `/health/`, which the real Django backend also
  // serves — reusing that silently ran the whole E2E suite against live data
  // and failed a dozen fixture-specific tests for reasons that looked like
  // app bugs. Probing something only the fixture can answer means a busy port
  // fails loudly at startup instead.
  if (path === '/__fixture__/health') {
    sendJson(req, res, 200, { fixture: true });
    return;
  }

  if (path === '/health/') {
    sendJson(req, res, 200, { status: 'ok' });
    return;
  }

  const posterMatch = path.match(/^\/media\/posters\/(\d+)\.png$/);
  if (posterMatch) {
    const png = POSTERS[Number(posterMatch[1]) % POSTERS.length];
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': png.length,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(png);
    return;
  }

  // ── GET /homepage ────────────────────────────────────────────────────────
  //
  // The fixture served EVERY events endpoint and none of this, so the landing
  // page rendered with no categories, no featured cities and no collections.
  // That is why 26 of the 31 failing e2e specs were in `discovery.spec.ts`:
  // not one assertion about prices or copy, but the whole page arriving empty,
  // which then fails the heading, the category links, the JSON-LD and axe in
  // one go.
  //
  // The shape is `Homepage` in `lib/api/cms.ts` and the eight categories are
  // the eight in `lib/discovery/categories.ts` — the same list the specs name.
  // A fixture that drifts from the contract is worse than no fixture, because
  // it fails somewhere far from the cause.
  if (path === '/api/v1/homepage') {
    const cards = (list) =>
      list.map((event, index) => ({
        entry_id: `entry-${event.id}-${index}`,
        id: event.id,
        // The readable half of `/events/{slug}-{id}`. On the card because a
        // CURATED front-page link must be the canonical URL rather than a
        // bare-uuid one that immediately 308s — a redirect on the most-clicked
        // links on the site. Mirrors `HomepageCardSerializer`.
        slug: event.slug,
        title: event.title,
        venue: event.venue,
        city: event.city,
        starts_at: event.starts_at,
        poster_url: event.poster_url,
        from_price: event.from_price,
        tickets_available: event.tickets_available,
        organization_id: event.organization_id,
        organization_name: event.organization_name,
      }));

    const upcoming = buildEvents().filter((event) => new Date(event.starts_at) > new Date());
    sendJson(req, res, 200, {
      hero: {
        headline: 'What do you feel like?',
        description: 'Concerts, comedy, workshops and more, across India.',
        primary_cta: 'Browse events',
        secondary_cta: 'Hire a performer',
        search_placeholder: 'Search events, artists or venues',
        trust_badges: ['Instant tickets', 'Verified organisers', 'Refund protection'],
      },
      ribbon: { enabled: false, text: '' },
      footer_note: '',
      categories: [
        { slug: 'concerts', label: 'Concerts', icon: 'Music', search_term: 'concert' },
        { slug: 'comedy', label: 'Comedy', icon: 'Mic', search_term: 'comedy' },
        { slug: 'workshops', label: 'Workshops', icon: 'Palette', search_term: 'workshop' },
        { slug: 'sports', label: 'Sports', icon: 'Trophy', search_term: 'sports' },
        { slug: 'festivals', label: 'Festivals', icon: 'Tent', search_term: 'festival' },
        { slug: 'nightlife', label: 'Nightlife', icon: 'Disc3', search_term: 'nightlife' },
        { slug: 'food-drink', label: 'Food & Drink', icon: 'UtensilsCrossed', search_term: 'food' },
        { slug: 'tech', label: 'Tech', icon: 'Cpu', search_term: 'tech' },
      ].map((entry, index) => ({ id: fixtureId(2000 + index), ...entry })),
      featured_cities: ['Mumbai', 'Bengaluru', 'Delhi', 'Pune'].map((name, index) => ({
        id: fixtureId(2100 + index),
        name,
        image_url: `${ORIGIN}/media/posters/${index}.png`,
      })),
      popular_searches: [
        { label: 'Comedy nights', query: 'comedy' },
        { label: 'This weekend', query: 'weekend' },
        { label: 'Live music', query: 'concert' },
      ].map((entry, index) => ({ id: fixtureId(2200 + index), ...entry })),
      collections: {
        featured: cards(upcoming.slice(0, 8)),
        trending: cards(upcoming.slice(8, 16)),
        editors_pick: cards(upcoming.slice(16, 24)),
        recommended: cards(upcoming.slice(24, 32)),
        new: cards(upcoming.slice(32, 40)),
      },
      version: 1,
      generated_at: new Date().toISOString(),
    }, LIST_CACHE_CONTROL);
    return;
  }

  // Deliberate SLOW switch, so route-level loading screens can be proven live
  // (the real fetch happens on the Next server, so a browser-side network
  // throttle can't reach it).
  if (path === '/api/v1/events' && url.searchParams.get('q') === '__slow__') {
    setTimeout(() => {
      sendJson(req, res, 200, { data: [], meta: { next: null, previous: null } });
    }, 4000);
    return;
  }

  // Deliberate failure switch, so the error/retry states can be proven live.
  if (path === '/api/v1/events' && url.searchParams.get('q') === '__boom__') {
    sendJson(req, res, 503, {
      error: {
        code: 'service_unavailable',
        message: 'Search is temporarily unavailable.',
        details: {},
      },
    });
    return;
  }

  if (path === '/api/v1/events') {
    const all = buildEvents();
    const matched = filterEvents(all, url.searchParams);
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('page_size')) || 20));
    const cursor = url.searchParams.get('cursor');
    const offset = cursor ? decodeCursor(cursor) : 0;
    const page = matched.slice(offset, offset + pageSize);
    const nextOffset = offset + pageSize;

    const withNext = (o) => {
      const next = new URL(url.toString());
      next.searchParams.set('cursor', encodeCursor(o));
      return next.toString();
    };

    sendJson(
      req,
      res,
      200,
      {
        data: page.map((e) => project(e, CARD_FIELDS)),
        meta: {
          next: nextOffset < matched.length ? withNext(nextOffset) : null,
          previous: offset > 0 ? withNext(Math.max(0, offset - pageSize)) : null,
        },
      },
      LIST_CACHE_CONTROL,
    );
    return;
  }

  /* ---------------------------------------------------------------- auth */
  if (path === '/api/v1/auth/oauth/google/signin/config' && req.method === 'GET') {
    sendJson(req, res, 200, { available: true });
    return;
  }

  if (path === '/api/v1/push/config' && req.method === 'GET') {
    sendJson(req, res, 200, { enabled: true, public_key: 'fixture-vapid-public-key' });
    return;
  }

  if (path === '/api/v1/auth/register' && req.method === 'POST') {
    void readBody(req).then((body) => {
      const email = String(body.email ?? '')
        .trim()
        .toLowerCase();
      const password = String(body.password ?? '');
      if (!email.includes('@')) {
        return authError(res, req, 400, 'invalid_input', 'Enter a valid email address.', {
          email: ['Enter a valid email address.'],
        });
      }
      if (password.length < 8) {
        return authError(res, req, 400, 'invalid_input', 'Password is too short.', {
          password: ['Password must be at least 8 characters.'],
        });
      }
      if (users.has(email)) {
        return authError(
          res,
          req,
          409,
          'email_already_registered',
          'That email is already registered.',
        );
      }
      const user = {
        id: fixtureId(50_000 + users.size),
        email,
        full_name: String(body.full_name ?? '').trim(),
        password,
        date_joined: new Date().toISOString(),
      };
      users.set(email, user);
      sendJson(req, res, 201, { user: userPayload(user), tokens: issueTokens(email) });
    });
    return;
  }

  if (path === '/api/v1/auth/login' && req.method === 'POST') {
    void readBody(req).then((body) => {
      const email = String(body.email ?? '')
        .trim()
        .toLowerCase();
      const user = users.get(email);
      if (!user || user.password !== String(body.password ?? '')) {
        return authError(res, req, 401, 'invalid_credentials', 'Email or password is incorrect.');
      }
      sendJson(req, res, 200, { user: userPayload(user), tokens: issueTokens(email) });
    });
    return;
  }

  if (path === '/api/v1/auth/me' && req.method === 'GET') {
    const user = authenticate(req);
    if (!user) return authError(res, req, 401, 'not_authenticated', 'Sign in to continue.');
    sendJson(req, res, 200, userPayload(user));
    return;
  }

  // PATCH /api/v1/auth/me — the profile edit.
  //
  // Added when the booking funnel's "Your details" sheet started using it. The
  // fixture 404'd the route, so the sheet's Confirm failed silently against
  // everything except a real backend, and an e2e run could not tell a broken
  // save from an unimplemented one. Returns the whole profile, exactly as the
  // real view does — the client swaps the object wholesale rather than
  // patching a field, so a partial response would leave a half-updated user.
  if (path === '/api/v1/auth/me' && req.method === 'PATCH') {
    const user = authenticate(req);
    if (!user) return authError(res, req, 401, 'not_authenticated', 'Sign in to continue.');
    void readBody(req).then((body) => {
      if (typeof body.full_name === 'string') user.full_name = body.full_name;
      if (typeof body.phone === 'string') user.phone = body.phone;
      sendJson(req, res, 200, userPayload(user));
    });
    return;
  }

  if (path === '/api/v1/auth/logout' && req.method === 'POST') {
    const header = req.headers.authorization ?? '';
    if (header.startsWith('Bearer ')) sessions.delete(header.slice(7));
    sendJson(req, res, 204, {});
    return;
  }

  /* ------------------------------------------------------------ bookings */
  if (path === '/api/v1/bookings' && req.method === 'POST') {
    const user = authenticate(req);
    if (!user) return authError(res, req, 401, 'not_authenticated', 'Sign in to continue.');

    void readBody(req).then((body) => {
      const event = buildEvents().find((e) => e.id === body.event_id);
      if (!event) {
        return authError(res, req, 404, 'event_not_found', 'Event not found.');
      }

      const key = req.headers['idempotency-key'];
      const idKey = key ? `${user.email}:${key}` : null;
      if (idKey && idempotency.has(idKey)) {
        const existing = bookings.get(idempotency.get(idKey));
        return sendJson(req, res, 201, bookingResponse(existing));
      }

      const tiers = buildTiers(event);
      const items = [];
      let total = 0;
      let quantity = 0;
      for (const requested of body.items ?? []) {
        const tier = tiers.find((t) => t.id === requested.ticket_type_id);
        if (!tier) {
          return authError(res, req, 404, 'ticket_type_not_found', 'That ticket type is gone.');
        }
        const qty = Number(requested.quantity ?? 0);
        if (qty > tier.available) {
          return authError(
            res,
            req,
            409,
            'sold_out',
            `Only ${tier.available} ${tier.name} tickets left.`,
          );
        }
        if (qty > tier.max_per_order) {
          return authError(
            res,
            req,
            409,
            'exceeds_max_per_order',
            `Up to ${tier.max_per_order} per order.`,
          );
        }
        // Priced under the same rule the locked reserve uses, so the booking the
        // funnel reads back agrees with the estimate it showed — and disagrees in
        // exactly the case the real one would, when an order straddles the cap.
        const billed = billFor(tier, qty);
        items.push({
          ticket_type_id: tier.id,
          ticket_type_name: tier.name,
          quantity: qty,
          unit_price: billed.unit_price,
          phase_name: billed.phase_name,
        });
        total += billed.unit_price * qty;
        quantity += qty;
      }
      if (!items.length) {
        return authError(res, req, 400, 'invalid_input', 'Choose at least one ticket.');
      }

      const donation = Number(body.donation_minor ?? 0);
      if (!Number.isInteger(donation) || donation < 0 || donation > DONATION_MAX_MINOR) {
        return authError(res, req, 400, 'invalid_input', 'That donation amount is not allowed.');
      }
      // Subtotal + fee + donation, the same three terms the backend charges.
      const platformFee = platformFeeFor(total);
      const grandTotal = total + platformFee + donation;

      const booking = {
        id: fixtureId(70_000 + bookings.size),
        user_email: user.email,
        event_id: event.id,
        event_title: event.title,
        status: 'reserved',
        total_amount: grandTotal,
        platform_fee: platformFee,
        donation,
        hold_expires_at: new Date(Date.now() + HOLD_MS).toISOString(),
        payment_order_id: `order_fixture_${bookings.size + 1}`,
        items,
        created_at: new Date().toISOString(),
      };
      bookings.set(booking.id, booking);
      // Hold the stock, so the next read of this event's tiers reflects it.
      for (const item of items) {
        reservedByTier.set(
          item.ticket_type_id,
          (reservedByTier.get(item.ticket_type_id) ?? 0) + item.quantity,
        );
      }
      if (idKey) idempotency.set(idKey, booking.id);
      sendJson(req, res, 201, bookingResponse(booking));
    });
    return;
  }

  // ── Set the donation on a live hold ─────────────────────────────────
  //
  // Mirrors `apps/booking.set_donation`, including the part that matters most:
  // it does NOT touch `reservedByTier`. A donation is not inventory, and a
  // fixture that released and re-reserved here would let a real release/reserve
  // bug through every test that used it.
  const donationMatch = path.match(/^\/api\/v1\/bookings\/([^/]+)\/donation\/?$/);
  if (donationMatch && req.method === 'POST') {
    const user = authenticate(req);
    if (!user) return authError(res, req, 401, 'not_authenticated', 'Sign in to continue.');
    const booking = bookings.get(donationMatch[1]);
    if (!booking || booking.user_email !== user.email) {
      return authError(res, req, 404, 'booking_not_found', 'Booking not found.');
    }
    void readBody(req).then((body) => {
      if (booking.status !== 'reserved') {
        // Mirrors `BookingNotModifiableError`. It used to reuse the CANCEL
        // error, which put "A booking in 'expired' state can't be cancelled."
        // on a checkout screen where somebody had just pressed a donate chip —
        // a message about an operation they never attempted.
        return authError(
          res,
          req,
          409,
          'booking_not_modifiable',
          booking.status === 'paid'
            ? 'This booking is already paid, so its total can no longer change.'
            : 'Your hold has expired and these tickets were released, so nothing can be added to this booking.',
        );
      }
      const next = Number(body.donation_minor ?? 0);
      if (!Number.isInteger(next) || next < 0 || next > DONATION_MAX_MINOR) {
        return authError(res, req, 400, 'invalid_input', 'That donation amount is not allowed.');
      }
      if (next !== booking.donation) {
        const withoutDonation = booking.total_amount - booking.donation;
        booking.donation = next;
        booking.total_amount = withoutDonation + next;
        // A new order for the new amount, exactly as the real service does —
        // a stale order would be paid at the old total and then refused by the
        // webhook's amount check.
        booking.payment_order_id = `order_fixture_${booking.id}_${next}`;
      }
      const { user_email: _ignored, ...payload } = booking;
      sendJson(req, res, 200, payload, 'private, no-store');
    });
    return;
  }

  const bookingMatch = path.match(/^\/api\/v1\/bookings\/([^/]+)\/?$/);
  if (bookingMatch && req.method === 'GET') {
    const user = authenticate(req);
    if (!user) return authError(res, req, 401, 'not_authenticated', 'Sign in to continue.');
    const booking = bookings.get(bookingMatch[1]);
    if (!booking || booking.user_email !== user.email) {
      return authError(res, req, 404, 'booking_not_found', 'Booking not found.');
    }
    const { user_email: _ignored, ...payload } = booking;
    sendJson(req, res, 200, payload, 'private, no-store');
    return;
  }

  // ── /events/sitemap and /performers/sitemap ──────────────────────────
  // Declared BEFORE the `/events/{id}` match below, exactly as the real
  // urls.py declares them before `<uuid:event_id>` — otherwise "sitemap" is
  // read as an event id and the endpoint 404s.
  if (path === '/api/v1/events/sitemap') {
    const rows = buildEvents().map((e) => ({
      id: e.id,
      slug: e.slug,
      // The fixture has no mutation, so every row's "last change" is the same
      // instant. Real enough to prove the frontend reads it rather than
      // stamping the build time on every entry.
      updated_at: e.starts_at,
    }));
    sendJson(req, res, 200, { data: rows }, 'public, max-age=600, s-maxage=3600');
    return;
  }

  if (path === '/api/v1/performers/sitemap') {
    // Empty, and that is the honest answer: the fixture publishes no acts, so
    // the sitemap carries no performer URLs rather than inventing any.
    sendJson(req, res, 200, { data: [] }, 'public, max-age=600, s-maxage=3600');
    return;
  }

  // GET /api/v1/events/{id}/content -> gallery, FAQs, running order, sessions.
  //
  // Added when the mobile event widget started reading it. Before this the
  // fixture 404'd the route, `fetchEventContentSafe` swallowed it and returned
  // empty, and every content-driven section was silently absent — so an e2e
  // suite could not tell "the organiser published nothing" from "the gallery is
  // broken". Both are now reachable: odd-indexed events get content, even ones
  // get none, which is the real distribution and exercises both branches.
  const contentMatch = path.match(/^\/api\/v1\/events\/([^/]+)\/content\/?$/);
  if (contentMatch) {
    const all = buildEvents();
    const index = all.findIndex((e) => e.id === contentMatch[1]);
    if (index === -1) {
      sendJson(req, res, 404, {
        error: { code: 'event_not_found', message: 'Event not found.', details: {} },
      });
      return;
    }
    sendJson(req, res, 200, buildContent(all[index], index, all), DETAIL_CACHE_CONTROL);
    return;
  }

  const tiersMatch = path.match(/^\/api\/v1\/events\/([^/]+)\/ticket-types\/?$/);
  if (tiersMatch) {
    const event = buildEvents().find((e) => e.id === tiersMatch[1]);
    if (!event) {
      sendJson(req, res, 404, {
        error: { code: 'event_not_found', message: 'Event not found.', details: {} },
      });
      return;
    }
    // The real endpoint caches for 5s, not 30 — inventory is the one public
    // read that must not sit behind the shared 30s clock.
    sendJson(req, res, 200, { data: buildTiers(event) }, TIERS_CACHE_CONTROL);
    return;
  }

  const detailMatch = path.match(/^\/api\/v1\/events\/([^/]+)\/?$/);
  if (detailMatch) {
    const all = buildEvents();
    const index = all.findIndex((e) => e.id === detailMatch[1]);
    const event = index === -1 ? undefined : all[index];
    if (!event) {
      sendJson(req, res, 404, {
        error: { code: 'event_not_found', message: 'Event not found.', details: {} },
      });
      return;
    }
    sendJson(
      req,
      res,
      200,
      {
        ...DETAIL_DEFAULTS,
        // Optional content columns, deterministic by index for the same reason
        // `buildContent` is: a spec must be able to assert that one event states
        // an age policy and another states none. Every one of these is `''` or
        // `[]` on the real API until an organiser fills it in, and the blank
        // case is the one the UI must handle by omitting a row, so half the
        // fixture leaves them blank.
        ...(index % 2 === 1
          ? {
              short_description: `${event.title} — a night at ${event.venue}.`,
              language: 'English',
              age_restriction: '18+',
              duration_minutes: 180,
              accessibility_notes: 'Step-free access from the main entrance.',
              policies: [
                {
                  title: 'Entry',
                  body: 'Carry a valid photo ID. Entry is refused without one.',
                },
                { title: 'Refunds', body: 'Tickets are non-refundable unless the event is cancelled.' },
              ],
            }
          : {}),
        created_at: event.starts_at,
        ...Object.fromEntries(
          Object.entries(project(event, DETAIL_FIELDS)).filter(([, v]) => v !== undefined),
        ),
      },
      DETAIL_CACHE_CONTROL,
    );
    return;
  }

  sendJson(req, res, 404, {
    error: { code: 'not_found', message: 'No such endpoint in the fixture.', details: {} },
  });
});

server.listen(PORT, () => {
  const count = buildEvents().length;
  // eslint-disable-next-line no-console
  console.log(
    `[mock-api] fixture backend on ${ORIGIN} — ${count} events, ${POSTERS.length} posters.\n` +
      `[mock-api] contract-identical to backend/apps/events/api.py. Stop it and run` +
      ` \`docker compose up\` at the repo root to use the real backend instead.`,
  );
});
