/**
 * Cities.
 *
 * ── TWO LISTS, AND THE DIFFERENCE BETWEEN THEM IS THE WHOLE POINT ─────────
 *
 * `POPULAR_CITIES` is CURATION — ten cities with an editorial one-liner. It is
 * what `generateStaticParams` prerenders, what the sitemap ships, and what the
 * chip grids offer as a first guess. It stays small on purpose: prerendering
 * two hundred landing pages for cities that may have no events in them is a
 * build cost paid on every deploy for pages nobody asked for.
 *
 * `INDIAN_CITIES` is COVERAGE — every city somebody would plausibly type,
 * A to Z, with its state. It exists because a city picker offering ten options
 * is not a city picker, and because "use my current location" has to be able
 * to land somewhere true. It is bundled rather than fetched: it is static
 * reference data, it is needed before any network call can return, and a
 * dropdown that waits on a request is a dropdown that is empty when it opens.
 *
 * ── THE NAME IS A FILTER VALUE, NOT A LABEL ──────────────────────────────
 *
 * `city` is matched EXACTLY by the backend (`qs.filter(city=city)`), so `name`
 * must be spelled the way organisers store it. That is also why the old
 * spellings live in `ALIASES` rather than as separate rows: "Bangalore" must
 * resolve to the one canonical "Bengaluru" we filter on, or a reverse-geocoded
 * fix would send a query string that matches nothing. See BACKLOG.md item 4 for
 * the `GET /events/cities` aggregate that would replace the guesswork.
 *
 * ── THE COORDINATES ARE FOR MATCHING, NEVER FOR DISPLAY ──────────────────
 *
 * City-centre coordinates at two decimals (~1km). They exist only to pick the
 * NEAREST city from a geolocation fix when reverse geocoding is unavailable —
 * they are never rendered, never used for a distance claim, and no "3.2km away"
 * is computed from them anywhere. A nearest-of-186 match is a genuine answer;
 * the nearest-of-10 match this list replaced told a user in Kochi they were in
 * Chennai.
 */

export type City = {
  name: string;
  slug: string;
  /** Indian state or union territory. Rendered as the disambiguator. */
  state: string;
  /** Degrees. Nearest-city matching only — see the note above. */
  lat: number;
  lng: number;
  /** Editorial one-liner. CURATED cities only; see `CuratedCity`. */
  blurb?: string;
};

/** A city with editorial copy — what a landing page and a city card need. */
export type CuratedCity = City & { blurb: string };

export const POPULAR_CITIES: CuratedCity[] = [
  {
    name: 'Mumbai',
    slug: 'mumbai',
    state: 'Maharashtra',
    lat: 19.076,
    lng: 72.8777,
    blurb: 'Arena tours & comedy clubs',
  },
  {
    name: 'Bengaluru',
    slug: 'bengaluru',
    state: 'Karnataka',
    lat: 12.9716,
    lng: 77.5946,
    blurb: 'Indie gigs & tech meetups',
  },
  {
    name: 'Delhi',
    slug: 'delhi',
    state: 'Delhi',
    lat: 28.6139,
    lng: 77.209,
    blurb: 'Festivals & stadium nights',
  },
  {
    name: 'Hyderabad',
    slug: 'hyderabad',
    state: 'Telangana',
    lat: 17.385,
    lng: 78.4867,
    blurb: 'Food trails & live music',
  },
  {
    name: 'Pune',
    slug: 'pune',
    state: 'Maharashtra',
    lat: 18.5204,
    lng: 73.8567,
    blurb: 'Campus gigs & open mics',
  },
  {
    name: 'Chennai',
    slug: 'chennai',
    state: 'Tamil Nadu',
    lat: 13.0827,
    lng: 80.2707,
    blurb: 'Sabhas & sporting nights',
  },
  {
    name: 'Kolkata',
    slug: 'kolkata',
    state: 'West Bengal',
    lat: 22.5726,
    lng: 88.3639,
    blurb: 'Culture fests & theatre',
  },
  {
    // The STATE, not Panaji — this is how organisers list events here, and the
    // filter value has to match what they typed. Adding Panaji as its own row
    // would make a fix inside Goa resolve to a name no event carries.
    name: 'Goa',
    slug: 'goa',
    state: 'Goa',
    lat: 15.2993,
    lng: 74.124,
    blurb: 'Beach festivals & afterhours',
  },
  {
    name: 'Jaipur',
    slug: 'jaipur',
    state: 'Rajasthan',
    lat: 26.9124,
    lng: 75.7873,
    blurb: 'Heritage nights & literature',
  },
  {
    name: 'Ahmedabad',
    slug: 'ahmedabad',
    state: 'Gujarat',
    lat: 23.0225,
    lng: 72.5714,
    blurb: 'Garba nights & food fests',
  },
];

/**
 * The rest of India, as tuples: `[name, state, lat, lng]`.
 *
 * Tuples rather than objects because this array ships to every browser — one
 * row of `{ name: …, slug: …, state: …, lat: …, lng: … }` repeats five keys
 * 176 times for no reader's benefit, and the slug is derivable. Expanded once
 * at module load below.
 *
 * The ten curated cities above are NOT repeated here; they are merged in by
 * `ALL_CITIES`, so their coordinates exist in exactly one place.
 */
type CityRow = [name: string, state: string, lat: number, lng: number];

const CITY_ROWS: CityRow[] = [
  ['Agartala', 'Tripura', 23.83, 91.28],
  ['Agra', 'Uttar Pradesh', 27.18, 78.02],
  ['Ahmednagar', 'Maharashtra', 19.09, 74.75],
  ['Aizawl', 'Mizoram', 23.73, 92.72],
  ['Ajmer', 'Rajasthan', 26.45, 74.64],
  ['Akola', 'Maharashtra', 20.7, 77.0],
  ['Alappuzha', 'Kerala', 9.49, 76.34],
  ['Aligarh', 'Uttar Pradesh', 27.9, 78.08],
  ['Alwar', 'Rajasthan', 27.55, 76.63],
  ['Ambala', 'Haryana', 30.38, 76.78],
  ['Amravati', 'Maharashtra', 20.93, 77.75],
  ['Amritsar', 'Punjab', 31.63, 74.87],
  ['Anand', 'Gujarat', 22.56, 72.96],
  ['Anantapur', 'Andhra Pradesh', 14.68, 77.6],
  ['Asansol', 'West Bengal', 23.68, 86.98],
  ['Aurangabad', 'Maharashtra', 19.88, 75.34],
  ['Ballari', 'Karnataka', 15.14, 76.92],
  ['Bareilly', 'Uttar Pradesh', 28.37, 79.43],
  ['Belagavi', 'Karnataka', 15.85, 74.5],
  ['Berhampur', 'Odisha', 19.31, 84.79],
  ['Bhagalpur', 'Bihar', 25.24, 86.99],
  ['Bharatpur', 'Rajasthan', 27.22, 77.49],
  ['Bhavnagar', 'Gujarat', 21.76, 72.15],
  ['Bhilai', 'Chhattisgarh', 21.19, 81.38],
  ['Bhilwara', 'Rajasthan', 25.35, 74.63],
  ['Bhiwandi', 'Maharashtra', 19.3, 73.06],
  ['Bhopal', 'Madhya Pradesh', 23.26, 77.41],
  ['Bhubaneswar', 'Odisha', 20.3, 85.82],
  ['Bhuj', 'Gujarat', 23.24, 69.67],
  ['Bikaner', 'Rajasthan', 28.02, 73.31],
  ['Bilaspur', 'Chhattisgarh', 22.08, 82.14],
  ['Bokaro Steel City', 'Jharkhand', 23.67, 86.15],
  ['Chandigarh', 'Chandigarh', 30.73, 76.78],
  ['Coimbatore', 'Tamil Nadu', 11.02, 76.96],
  ['Cuttack', 'Odisha', 20.46, 85.88],
  ['Daman', 'Dadra and Nagar Haveli and Daman and Diu', 20.4, 72.83],
  ['Darbhanga', 'Bihar', 26.15, 85.9],
  ['Darjeeling', 'West Bengal', 27.04, 88.26],
  ['Davanagere', 'Karnataka', 14.47, 75.92],
  ['Dehradun', 'Uttarakhand', 30.32, 78.03],
  ['Dhanbad', 'Jharkhand', 23.8, 86.43],
  ['Dharamshala', 'Himachal Pradesh', 32.22, 76.32],
  ['Dhule', 'Maharashtra', 20.9, 74.77],
  ['Dibrugarh', 'Assam', 27.47, 94.91],
  ['Dimapur', 'Nagaland', 25.9, 93.73],
  ['Dindigul', 'Tamil Nadu', 10.37, 77.98],
  ['Durgapur', 'West Bengal', 23.55, 87.31],
  ['Eluru', 'Andhra Pradesh', 16.71, 81.1],
  ['Erode', 'Tamil Nadu', 11.34, 77.72],
  ['Faridabad', 'Haryana', 28.41, 77.31],
  ['Firozabad', 'Uttar Pradesh', 27.15, 78.4],
  ['Gandhinagar', 'Gujarat', 23.22, 72.68],
  ['Gangtok', 'Sikkim', 27.33, 88.61],
  ['Gaya', 'Bihar', 24.79, 85.0],
  ['Ghaziabad', 'Uttar Pradesh', 28.67, 77.44],
  ['Gorakhpur', 'Uttar Pradesh', 26.76, 83.37],
  ['Guntur', 'Andhra Pradesh', 16.31, 80.44],
  ['Gurugram', 'Haryana', 28.46, 77.03],
  ['Guwahati', 'Assam', 26.14, 91.74],
  ['Gwalior', 'Madhya Pradesh', 26.22, 78.18],
  ['Haldwani', 'Uttarakhand', 29.22, 79.52],
  ['Haridwar', 'Uttarakhand', 29.95, 78.16],
  ['Hassan', 'Karnataka', 13.01, 76.1],
  ['Hisar', 'Haryana', 29.15, 75.72],
  ['Hubballi', 'Karnataka', 15.36, 75.12],
  ['Imphal', 'Manipur', 24.82, 93.94],
  ['Indore', 'Madhya Pradesh', 22.72, 75.86],
  ['Itanagar', 'Arunachal Pradesh', 27.08, 93.61],
  ['Jabalpur', 'Madhya Pradesh', 23.18, 79.99],
  ['Jalandhar', 'Punjab', 31.33, 75.58],
  ['Jalgaon', 'Maharashtra', 21.01, 75.56],
  ['Jammu', 'Jammu and Kashmir', 32.73, 74.87],
  ['Jamnagar', 'Gujarat', 22.47, 70.06],
  ['Jamshedpur', 'Jharkhand', 22.8, 86.19],
  ['Jhansi', 'Uttar Pradesh', 25.45, 78.57],
  ['Jodhpur', 'Rajasthan', 26.24, 73.02],
  ['Jorhat', 'Assam', 26.75, 94.22],
  ['Junagadh', 'Gujarat', 21.52, 70.46],
  ['Kadapa', 'Andhra Pradesh', 14.47, 78.82],
  ['Kakinada', 'Andhra Pradesh', 16.99, 82.25],
  ['Kalaburagi', 'Karnataka', 17.33, 76.83],
  ['Kalyan-Dombivli', 'Maharashtra', 19.24, 73.13],
  ['Kanchipuram', 'Tamil Nadu', 12.84, 79.7],
  ['Kannur', 'Kerala', 11.87, 75.37],
  ['Kanpur', 'Uttar Pradesh', 26.45, 80.33],
  ['Karimnagar', 'Telangana', 18.44, 79.13],
  ['Karnal', 'Haryana', 29.69, 76.99],
  ['Kavaratti', 'Lakshadweep', 10.57, 72.64],
  ['Khammam', 'Telangana', 17.25, 80.15],
  ['Kochi', 'Kerala', 9.93, 76.27],
  ['Kohima', 'Nagaland', 25.67, 94.11],
  ['Kolhapur', 'Maharashtra', 16.7, 74.24],
  ['Kollam', 'Kerala', 8.89, 76.61],
  ['Korba', 'Chhattisgarh', 22.35, 82.68],
  ['Kota', 'Rajasthan', 25.21, 75.86],
  ['Kottayam', 'Kerala', 9.59, 76.52],
  ['Kozhikode', 'Kerala', 11.26, 75.78],
  ['Kurnool', 'Andhra Pradesh', 15.83, 78.04],
  ['Latur', 'Maharashtra', 18.4, 76.58],
  ['Leh', 'Ladakh', 34.16, 77.58],
  ['Lucknow', 'Uttar Pradesh', 26.85, 80.95],
  ['Ludhiana', 'Punjab', 30.9, 75.86],
  ['Madurai', 'Tamil Nadu', 9.93, 78.12],
  ['Malappuram', 'Kerala', 11.05, 76.07],
  ['Mangaluru', 'Karnataka', 12.87, 74.84],
  ['Mathura', 'Uttar Pradesh', 27.49, 77.67],
  ['Meerut', 'Uttar Pradesh', 28.98, 77.71],
  ['Moradabad', 'Uttar Pradesh', 28.84, 78.77],
  ['Muzaffarnagar', 'Uttar Pradesh', 29.47, 77.7],
  ['Muzaffarpur', 'Bihar', 26.12, 85.39],
  ['Mysuru', 'Karnataka', 12.3, 76.64],
  ['Nagercoil', 'Tamil Nadu', 8.18, 77.43],
  ['Nagpur', 'Maharashtra', 21.15, 79.09],
  ['Nanded', 'Maharashtra', 19.15, 77.32],
  ['Nashik', 'Maharashtra', 20.01, 73.79],
  ['Navi Mumbai', 'Maharashtra', 19.03, 73.03],
  ['Nellore', 'Andhra Pradesh', 14.44, 79.99],
  ['Nizamabad', 'Telangana', 18.67, 78.09],
  ['Noida', 'Uttar Pradesh', 28.54, 77.39],
  ['Ooty', 'Tamil Nadu', 11.41, 76.7],
  ['Palakkad', 'Kerala', 10.78, 76.65],
  ['Panipat', 'Haryana', 29.39, 76.97],
  ['Pathankot', 'Punjab', 32.27, 75.65],
  ['Patiala', 'Punjab', 30.34, 76.39],
  ['Patna', 'Bihar', 25.59, 85.14],
  ['Port Blair', 'Andaman and Nicobar Islands', 11.62, 92.73],
  ['Prayagraj', 'Uttar Pradesh', 25.44, 81.85],
  ['Puducherry', 'Puducherry', 11.94, 79.83],
  ['Puri', 'Odisha', 19.81, 85.83],
  ['Raipur', 'Chhattisgarh', 21.25, 81.63],
  ['Rajahmundry', 'Andhra Pradesh', 17.0, 81.78],
  ['Rajkot', 'Gujarat', 22.3, 70.8],
  ['Ranchi', 'Jharkhand', 23.34, 85.31],
  ['Ratlam', 'Madhya Pradesh', 23.33, 75.04],
  ['Rishikesh', 'Uttarakhand', 30.09, 78.27],
  ['Rohtak', 'Haryana', 28.89, 76.61],
  ['Roorkee', 'Uttarakhand', 29.87, 77.89],
  ['Rourkela', 'Odisha', 22.26, 84.85],
  ['Sagar', 'Madhya Pradesh', 23.84, 78.74],
  ['Saharanpur', 'Uttar Pradesh', 29.97, 77.55],
  ['Salem', 'Tamil Nadu', 11.66, 78.15],
  ['Sambalpur', 'Odisha', 21.47, 83.97],
  ['Sangli', 'Maharashtra', 16.85, 74.58],
  ['Satara', 'Maharashtra', 17.69, 74.0],
  ['Shillong', 'Meghalaya', 25.58, 91.89],
  ['Shimla', 'Himachal Pradesh', 31.1, 77.17],
  ['Shivamogga', 'Karnataka', 13.93, 75.57],
  ['Siliguri', 'West Bengal', 26.73, 88.4],
  ['Silvassa', 'Dadra and Nagar Haveli and Daman and Diu', 20.27, 73.02],
  ['Solapur', 'Maharashtra', 17.66, 75.91],
  ['Sonipat', 'Haryana', 28.99, 77.02],
  ['Srinagar', 'Jammu and Kashmir', 34.08, 74.8],
  ['Surat', 'Gujarat', 21.17, 72.83],
  ['Thane', 'Maharashtra', 19.22, 72.98],
  ['Thanjavur', 'Tamil Nadu', 10.79, 79.14],
  ['Thiruvananthapuram', 'Kerala', 8.52, 76.94],
  ['Thrissur', 'Kerala', 10.53, 76.21],
  ['Tiruchirappalli', 'Tamil Nadu', 10.79, 78.7],
  ['Tirunelveli', 'Tamil Nadu', 8.71, 77.76],
  ['Tirupati', 'Andhra Pradesh', 13.63, 79.42],
  ['Tiruppur', 'Tamil Nadu', 11.11, 77.34],
  ['Tumakuru', 'Karnataka', 13.34, 77.1],
  ['Udaipur', 'Rajasthan', 24.58, 73.71],
  ['Udupi', 'Karnataka', 13.34, 74.75],
  ['Ujjain', 'Madhya Pradesh', 23.18, 75.78],
  ['Ulhasnagar', 'Maharashtra', 19.22, 73.15],
  ['Vadodara', 'Gujarat', 22.31, 73.18],
  ['Varanasi', 'Uttar Pradesh', 25.32, 82.97],
  ['Vasai-Virar', 'Maharashtra', 19.39, 72.83],
  ['Vellore', 'Tamil Nadu', 12.92, 79.13],
  ['Vijayapura', 'Karnataka', 16.83, 75.71],
  ['Vijayawada', 'Andhra Pradesh', 16.51, 80.65],
  ['Visakhapatnam', 'Andhra Pradesh', 17.69, 83.22],
  ['Warangal', 'Telangana', 17.98, 79.6],
  ['Yamunanagar', 'Haryana', 30.13, 77.29],
];

/** URL-safe slug. `Kalyan-Dombivli` -> `kalyan-dombivli`. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Coverage — every city in `CITY_ROWS`, expanded. Curated cities are separate. */
export const INDIAN_CITIES: City[] = CITY_ROWS.map(([name, state, lat, lng]) => ({
  name,
  slug: slugify(name),
  state,
  lat,
  lng,
}));

/**
 * Everything the picker offers, A-Z, curated cities merged in.
 *
 * Sorted with `localeCompare` rather than `<` so the order is the one a reader
 * expects rather than the one ASCII produces.
 */
export const ALL_CITIES: City[] = [...POPULAR_CITIES, ...INDIAN_CITIES].sort((a, b) =>
  a.name.localeCompare(b.name, 'en'),
);

/**
 * Old and colloquial spellings -> the canonical name we filter on.
 *
 * This is what makes reverse geocoding usable: Google answers with whatever
 * the locality is currently called, an organiser typed whatever they call it,
 * and only one of the two can be the query string. Keys are normalised (see
 * `normalise`).
 */
const ALIASES: Record<string, string> = {
  bangalore: 'Bengaluru',
  bombay: 'Mumbai',
  calcutta: 'Kolkata',
  madras: 'Chennai',
  'new delhi': 'Delhi',
  'delhi ncr': 'Delhi',
  gurgaon: 'Gurugram',
  poona: 'Pune',
  trivandrum: 'Thiruvananthapuram',
  cochin: 'Kochi',
  ernakulam: 'Kochi',
  calicut: 'Kozhikode',
  mysore: 'Mysuru',
  mangalore: 'Mangaluru',
  belgaum: 'Belagavi',
  hubli: 'Hubballi',
  'hubli dharwad': 'Hubballi',
  gulbarga: 'Kalaburagi',
  bellary: 'Ballari',
  bijapur: 'Vijayapura',
  shimoga: 'Shivamogga',
  tumkur: 'Tumakuru',
  baroda: 'Vadodara',
  pondicherry: 'Puducherry',
  allahabad: 'Prayagraj',
  trichy: 'Tiruchirappalli',
  tiruchirapalli: 'Tiruchirappalli',
  'chhatrapati sambhajinagar': 'Aurangabad',
  udhagamandalam: 'Ooty',
  simla: 'Shimla',
  panjim: 'Goa',
  panaji: 'Goa',
  margao: 'Goa',
  vasco: 'Goa',
  'greater noida': 'Noida',
  'gautam buddha nagar': 'Noida',
  secunderabad: 'Hyderabad',
};

const BY_SLUG = new Map(POPULAR_CITIES.map((c) => [c.slug, c]));
const ANY_BY_SLUG = new Map(ALL_CITIES.map((c) => [c.slug, c]));
const ANY_BY_NAME = new Map(ALL_CITIES.map((c) => [c.name.toLowerCase(), c]));

/**
 * A CURATED city by slug. Deliberately still bounded to `POPULAR_CITIES`:
 * `/cities/[slug]` prerenders from the same list and its copy reads
 * `city.blurb`, so widening this would mint landing pages with no editorial
 * line and no entry in the sitemap.
 */
export function cityBySlug(slug: string | null | undefined): CuratedCity | null {
  if (!slug) return null;
  return BY_SLUG.get(slug.toLowerCase()) ?? null;
}

/** Any city by slug — the picker's own routing, not the landing pages'. */
export function anyCityBySlug(slug: string | null | undefined): City | null {
  if (!slug) return null;
  return ANY_BY_SLUG.get(slug.toLowerCase()) ?? null;
}

/** Any city by exact name. What a stored choice is re-resolved through. */
export function cityByName(name: string | null | undefined): City | null {
  if (!name) return null;
  return ANY_BY_NAME.get(name.trim().toLowerCase()) ?? null;
}

/** Lowercased, punctuation-free, administrative noise removed. */
function normalise(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(
      /\b(district|urban|rural|city|municipal|corporation|taluk|taluka|tehsil|mandal|division|metropolitan|area)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

const NORMALISED_ALIASES = new Map(Object.entries(ALIASES).map(([k, v]) => [normalise(k), v]));
const BY_NORMALISED = new Map(ALL_CITIES.map((c) => [normalise(c.name), c]));

/**
 * A free-text place name -> a city we can filter on, or null.
 *
 * Written for the strings a geocoder actually returns: "Bengaluru Urban",
 * "Mumbai Suburban District", "New Delhi", "Ernakulam". Three passes, most
 * confident first — exact, aliased, then a whole-word containment check
 * guarded to names of four characters or more, because a two-letter
 * containment match would resolve half the country to the wrong place.
 *
 * Returns null rather than a nearest guess. A guess belongs to
 * `nearestCity`, which the caller labels as approximate; silently promoting
 * one here would make an approximate answer indistinguishable from a real one.
 */
export function matchCityName(raw: string | null | undefined): City | null {
  if (!raw) return null;
  const key = normalise(raw);
  if (!key) return null;

  const exact = BY_NORMALISED.get(key);
  if (exact) return exact;

  const aliased = NORMALISED_ALIASES.get(key);
  if (aliased) return cityByName(aliased);

  for (const [normalisedName, city] of BY_NORMALISED) {
    if (normalisedName.length < 4) continue;
    if (new RegExp(`\\b${normalisedName}\\b`).test(key)) return city;
  }
  for (const [alias, canonical] of NORMALISED_ALIASES) {
    if (alias.length < 4) continue;
    if (new RegExp(`\\b${alias}\\b`).test(key)) return cityByName(canonical);
  }
  return null;
}

/** Great-circle distance in km. */
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The nearest city to a geolocation fix, or null if the fix is further than
 * `maxKm` from every one of them.
 *
 * APPROXIMATE BY CONSTRUCTION, and every caller must present it that way. It
 * is the fallback for when reverse geocoding cannot answer — which today is
 * every anonymous visitor, because `GET /maps/geocode` is `IsAuthenticated`
 * (see `needs_from_others`). With 186 cities the answer is usually the right
 * one; it is still a nearest-match, not a location.
 *
 * `maxKm` is deliberately tighter than the 400km this used when there were ten
 * cities to choose from: with full coverage, a fix 150km from the nearest city
 * is genuinely somewhere we cannot name.
 */
export function nearestCity(lat: number, lng: number, maxKm = 150): City | null {
  let best: City | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const city of ALL_CITIES) {
    const d = distanceKm(lat, lng, city.lat, city.lng);
    if (d < bestDistance) {
      bestDistance = d;
      best = city;
    }
  }
  return bestDistance <= maxKm ? best : null;
}

export type CityGroup = { letter: string; cities: City[] };

/**
 * `ALL_CITIES` bucketed under its initial, in order — what the A-Z list and
 * its index rail both render from, so a rail letter can never point at a
 * heading that does not exist.
 */
export function groupCitiesByLetter(cities: City[] = ALL_CITIES): CityGroup[] {
  const groups: CityGroup[] = [];
  for (const city of cities) {
    const letter = city.name[0]?.toUpperCase() ?? '#';
    const last = groups[groups.length - 1];
    if (last && last.letter === letter) last.cities.push(city);
    else groups.push({ letter, cities: [city] });
  }
  return groups;
}

/**
 * Type-ahead over the bundled list.
 *
 * Prefix matches rank above contained ones, so typing "man" offers Mangaluru
 * before Osmanabad; the state is matched too, because "kerala" is a reasonable
 * thing to type when you cannot remember how Thiruvananthapuram is spelled.
 * Aliases are searchable but resolve to the canonical row — somebody typing
 * "Bangalore" finds Bengaluru rather than nothing.
 */
export function searchCities(query: string, cities: City[] = ALL_CITIES): City[] {
  const q = query.trim().toLowerCase();
  if (!q) return cities;

  // Every canonical name an alias PREFIXED by the query points at, so the
  // match arrives while the word is still being typed ("bang" -> Bengaluru)
  // rather than only on the last keystroke.
  const aliasTargets = new Set<string>();
  for (const [alias, canonical] of NORMALISED_ALIASES) {
    if (alias.startsWith(normalise(q))) aliasTargets.add(canonical);
  }

  const aliased: City[] = [];
  const prefix: City[] = [];
  const contains: City[] = [];
  for (const city of cities) {
    const name = city.name.toLowerCase();
    if (name.startsWith(q)) prefix.push(city);
    else if (aliasTargets.has(city.name)) aliased.push(city);
    else if (name.includes(q) || city.state.toLowerCase().includes(q)) contains.push(city);
  }
  return [...prefix, ...aliased, ...contains];
}
