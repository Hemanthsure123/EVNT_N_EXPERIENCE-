import * as React from 'react';
import { BookingPipeline } from '@/components/performer/pipeline-calendar-analytics';

export const metadata = { title: 'Pipeline' };

export default function PipelinePage({ params }: { params: { id: string } }) {
  return <BookingPipeline performerId={params.id} />;
}
