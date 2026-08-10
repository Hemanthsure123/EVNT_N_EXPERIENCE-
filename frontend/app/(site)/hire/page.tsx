import type { Metadata } from 'next';
import { Container } from '@/components/shell/container';
import { BriefForm } from '@/components/hire/brief-form';
import { pageMetadata } from '@/lib/seo/metadata';

/**
 * Hire an act.
 *
 * ── THIS PAGE USED TO BE A MARKETPLACE ────────────────────────────────────
 *
 * It listed performers with photos, prices and filters, and a brief posted
 * here was answered by whichever of them fitted. The platform has no supply
 * side now, so there is nothing to list — and a browse page rendering an empty
 * grid is a shop with nothing in it and no sign saying so.
 *
 * What replaced it is the thing that was always underneath: describe what you
 * need, and a person on our team gets back to you. That is one screen, so this
 * route is the form rather than a landing page that links to one.
 *
 * ── AND IT IS STILL INDEXED ───────────────────────────────────────────────
 *
 * "Hire a band in Mumbai" is a real search somebody makes, and this is a real
 * answer to it. The metadata describes what the page DOES rather than
 * advertising a catalogue that is not there.
 */
export const metadata: Metadata = pageMetadata(
  'Hire a band, DJ or performer',
  'Tell us what you need for your wedding, party or corporate event, and our team will get '
    + 'back to you with options and prices.',
);

export default function HirePage() {
  return (
    <Container className="py-8 lg:py-12">
      <BriefForm />
    </Container>
  );
}
