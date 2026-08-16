import * as React from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Container } from '@/components/shell/container';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { PerformerProfile } from '@/components/hire/performer-profile';
import {
  PERFORMER_TYPE_LABELS,
  fetchPerformerDetail,
  type PerformerDetail,
} from '@/lib/api/performers';
import { JsonLd, breadcrumbJsonLd, performerJsonLd } from '@/lib/seo/json-ld';
import { SITE_URL, pageMetadata } from '@/lib/seo/metadata';

/**
 * A performer's public profile.
 *
 * Server-rendered and ISR'd on the same clock as the backend's own
 * `s-maxage=60`, so the page, the Next data cache and the edge age together
 * rather than on three different timers. Nothing here is per-visitor.
 */
export const revalidate = 60;

async function getPerformer(id: string): Promise<PerformerDetail | null> {
  try {
    return await fetchPerformerDetail(id);
  } catch {
    // A draft, a rejected profile and a nonexistent id are all 404 from the
    // API — the page treats them identically rather than leaking which.
    return null;
  }
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const performer = await getPerformer(params.id);
  if (!performer) return pageMetadata('Performer not found');

  const description =
    performer.tagline ||
    `${PERFORMER_TYPE_LABELS[performer.performer_type]} based in ${performer.city}. Request a quote on Curatix.`;

  return {
    ...pageMetadata(performer.stage_name, description),
    alternates: { canonical: `/hire/${performer.id}` },
    openGraph: {
      title: performer.stage_name,
      description,
      ...(performer.photos[0] ? { images: [{ url: performer.photos[0].url }] } : {}),
    },
  };
}

export default async function PerformerPage({ params }: { params: { id: string } }) {
  const performer = await getPerformer(params.id);
  if (!performer) notFound();

  const url = `${SITE_URL}/hire/${performer.id}`;

  return (
    <Container className="flex flex-col gap-8 py-8 lg:gap-10 lg:py-10">
      {/* These pages carried NO structured data at all — the one public page
          type on the platform that described nothing about itself to a
          crawler. `PerformingGroup` rather than `Person`: what is listed is an
          ACT, and a solo artist is still an act as far as a booking goes. */}
      <JsonLd
        data={performerJsonLd({
          name: performer.stage_name,
          url,
          description: performer.tagline || performer.bio || undefined,
          image: performer.photos[0]?.url || undefined,
          city: performer.city,
          genres: performer.genres,
          // A floor, not a price — and null ("price on ask") emits no offer at
          // all rather than a zero, which would read as "free".
          startingPriceMinor: performer.base_price_minor,
        })}
      />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Home', url: SITE_URL },
          { name: 'Hire a performer', url: `${SITE_URL}/hire` },
          { name: performer.stage_name, url },
        ])}
      />

      <Breadcrumb
        items={[
          { label: 'Home', href: '/' },
          { label: 'Hire a performer', href: '/hire' },
          { label: performer.stage_name },
        ]}
      />
      <PerformerProfile performer={performer} />
    </Container>
  );
}
