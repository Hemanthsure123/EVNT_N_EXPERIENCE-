import * as React from 'react';
import { StudioAnalytics } from '@/components/performer/pipeline-calendar-analytics';

export const metadata = { title: 'Analytics' };

export default function AnalyticsPage({ params }: { params: { id: string } }) {
  return <StudioAnalytics performerId={params.id} />;
}
