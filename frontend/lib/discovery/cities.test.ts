import { describe, expect, it } from 'vitest';
import {
  ALL_CITIES,
  INDIAN_CITIES,
  POPULAR_CITIES,
  anyCityBySlug,
  cityByName,
  cityBySlug,
  groupCitiesByLetter,
  matchCityName,
  nearestCity,
  searchCities,
} from './cities';

/**
 * The city table is reference data, so what is worth testing is not its
 * contents but the four things that quietly break: a duplicate slug (two rows
 * with one URL), a geocoded name that resolves to the wrong place, a rail
 * letter that points at a heading that does not exist, and the nearest-match
 * that used to be wrong by six hundred kilometres.
 */
describe('the city table', () => {
  it('has no duplicate slugs, so no two rows share a URL', () => {
    const slugs = ALL_CITIES.map((city) => city.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('does not repeat the curated ten inside the coverage list', () => {
    const curated = new Set(POPULAR_CITIES.map((city) => city.slug));
    expect(INDIAN_CITIES.filter((city) => curated.has(city.slug))).toEqual([]);
  });

  it('covers enough of India to be a city picker rather than a shortlist', () => {
    // 150+ was the brief; the assertion is a floor, not the count, so adding a
    // city never breaks a test.
    expect(ALL_CITIES.length).toBeGreaterThanOrEqual(150);
  });

  it('gives every row a state, because a bare name is ambiguous', () => {
    // There is an Aurangabad in two states and a Bilaspur in three.
    expect(ALL_CITIES.filter((city) => !city.state)).toEqual([]);
  });
});

describe('cityBySlug', () => {
  it('stays bounded to the curated list, which is what gets prerendered', () => {
    // `/cities/[slug]` prerenders from POPULAR_CITIES and its copy reads
    // `blurb`. Widening this would mint landing pages with no editorial line.
    expect(cityBySlug('mumbai')?.name).toBe('Mumbai');
    expect(cityBySlug('kochi')).toBeNull();
  });

  it('resolves any city through the picker-facing lookup', () => {
    expect(anyCityBySlug('kochi')?.name).toBe('Kochi');
    expect(anyCityBySlug('kalyan-dombivli')?.name).toBe('Kalyan-Dombivli');
  });
});

describe('cityByName', () => {
  it('re-resolves a stored choice from anywhere in the table', () => {
    // A city chosen in the sheet is persisted by NAME, so a coverage city that
    // did not resolve here would silently vanish on the next page load.
    expect(cityByName('Thiruvananthapuram')?.slug).toBe('thiruvananthapuram');
    expect(cityByName('  bengaluru ')?.name).toBe('Bengaluru');
    expect(cityByName('Atlantis')).toBeNull();
  });
});

describe('matchCityName', () => {
  it('accepts the spellings a geocoder actually returns', () => {
    expect(matchCityName('Bengaluru Urban')?.name).toBe('Bengaluru');
    expect(matchCityName('Mumbai Suburban District')?.name).toBe('Mumbai');
    expect(matchCityName('New Delhi')?.name).toBe('Delhi');
  });

  it('maps old and colloquial names onto the one we filter on', () => {
    // `city` is matched EXACTLY by the backend, so "Bangalore" has to become
    // "Bengaluru" or the query string matches nothing at all.
    expect(matchCityName('Bangalore')?.name).toBe('Bengaluru');
    expect(matchCityName('Ernakulam')?.name).toBe('Kochi');
    expect(matchCityName('Gurgaon')?.name).toBe('Gurugram');
    expect(matchCityName('Panaji')?.name).toBe('Goa');
  });

  it('returns null rather than a nearest guess', () => {
    // A guess is `nearestCity`'s job, and the caller labels that as
    // approximate. Promoting one here would make the two indistinguishable.
    expect(matchCityName('Paris')).toBeNull();
    expect(matchCityName('')).toBeNull();
    expect(matchCityName(null)).toBeNull();
  });
});

describe('nearestCity', () => {
  it('no longer tells somebody in Kochi they are in Chennai', () => {
    // The regression this whole slice exists for: the old table had ten
    // coordinates and a 400km radius, so a fix in Kerala matched Chennai.
    expect(nearestCity(9.93, 76.27)?.name).toBe('Kochi');
    expect(nearestCity(26.75, 94.22)?.name).toBe('Jorhat');
    expect(nearestCity(15.85, 74.5)?.name).toBe('Belagavi');
  });

  it('answers nothing rather than something wrong when far away', () => {
    expect(nearestCity(48.85, 2.35)).toBeNull();
  });
});

describe('groupCitiesByLetter', () => {
  const groups = groupCitiesByLetter();

  it('loses nobody', () => {
    expect(groups.reduce((total, group) => total + group.cities.length, 0)).toBe(ALL_CITIES.length);
  });

  it('puts every city under its own initial', () => {
    // The rail jumps to a heading by letter; a row filed under the wrong one
    // is a row nobody can find by jumping.
    for (const group of groups) {
      for (const city of group.cities) {
        expect(city.name[0]?.toUpperCase()).toBe(group.letter);
      }
    }
  });

  it('emits each letter exactly once, in order', () => {
    const letters = groups.map((group) => group.letter);
    expect(new Set(letters).size).toBe(letters.length);
    expect([...letters].sort()).toEqual(letters);
  });
});

describe('searchCities', () => {
  it('ranks a prefix above a containment', () => {
    const results = searchCities('mad');
    expect(results[0]?.name).toBe('Madurai');
  });

  it('finds a city through the name somebody still calls it', () => {
    expect(searchCities('bang')[0]?.name).toBe('Bengaluru');
  });

  it('matches the state, because that is what people type when unsure', () => {
    const kerala = searchCities('kerala');
    expect(kerala.map((city) => city.name)).toContain('Kochi');
    expect(kerala.every((city) => city.state === 'Kerala')).toBe(true);
  });

  it('returns everything for an empty query', () => {
    expect(searchCities('   ')).toHaveLength(ALL_CITIES.length);
  });
});
