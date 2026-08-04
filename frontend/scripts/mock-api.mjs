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
  const sources = lights.map((colour, i) => ({
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
        events.push({
          id: fixtureId(n),
          title: copy === 0 ? title : `${title} — ${pick(rnd, CITIES)} Edition`,
          venue: pick(rnd, seed.venues),
          city: pick(rnd, CITIES),
          starts_at: startsAt.toISOString(),
          ends_at: new Date(startsAt.getTime() + 3 * HOUR).toISOString(),
          description: `An unmissable ${seed.keyword} night presented by ${org}, live and in full. Doors open an hour before showtime; entry is a single QR scan at the gate.`,
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

/** Matches backend PLATFORM_FEE_PER_TICKET (paise), taken OUT of the total. */
const PLATFORM_FEE_PER_TICKET = 10;
/** Matches backend BOOKING_HOLD_MINUTES. */
const HOLD_MINUTES = 10;

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
  'title',
  'venue',
  'city',
  'starts_at',
  'poster_url',
  'from_price',
  'tickets_available',
  'organization_id',
  'organization_name',
];

const DETAIL_FIELDS = [
  'id',
  'organization_id',
  'organization_name',
  'title',
  'description',
  'venue',
  'city',
  'starts_at',
  'ends_at',
  'poster_url',
  'from_price',
  'tickets_available',
];

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

      const booking = {
        id: fixtureId(70_000 + bookings.size),
        user_email: user.email,
        event_id: event.id,
        event_title: event.title,
        status: 'reserved',
        total_amount: total,
        platform_fee: PLATFORM_FEE_PER_TICKET * quantity,
        hold_expires_at: new Date(Date.now() + HOLD_MINUTES * 60_000).toISOString(),
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
    const event = buildEvents().find((e) => e.id === detailMatch[1]);
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
      { ...project(event, DETAIL_FIELDS), status: 'live', version: 1 },
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
