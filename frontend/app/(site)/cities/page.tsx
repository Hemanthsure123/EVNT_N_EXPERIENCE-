import * as React from 'react';
import type { Metadata } from 'next';
import { Container } from '@/components/shell/container';
import { PopularCities } from '@/components/discovery/popular-cities';
import { CategoryTiles } from '@/components/discovery/category-tiles';
import { pageMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = {
  ...pageMetadata(
    'Events by city',
    'Pick a city and see everything on sale there — concerts, comedy, workshops, sports, festivals, nightlife, food and tech.',
  ),
  alternates: { canonical: '/cities' },
};

/** Fully static — a link hub for the city landing pages. */
export default function CitiesPage() {
  return (
    <Container className="flex flex-col gap-10 py-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-h1">Events by city</h1>
        <p className="max-w-2xl text-body-lg text-muted-foreground">
          Pick a city to see what&apos;s on. You can also set your city from the top nav and
          we&apos;ll put nearby events first everywhere.
        </p>
      </header>

      <PopularCities />

      <section className="flex flex-col gap-4">
        <h2 className="text-h3">Or start from a category</h2>
        <CategoryTiles />
      </section>
    </Container>
  );
}
