import * as React from 'react';
import { StudioHome } from '@/components/performer/studio-home';

export const metadata = { title: 'Overview' };

export default function StudioHomePage({ params }: { params: { id: string } }) {
  return <StudioHome performerId={params.id} />;
}
