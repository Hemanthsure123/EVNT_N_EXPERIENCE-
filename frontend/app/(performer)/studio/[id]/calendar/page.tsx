import * as React from 'react';
import { StudioCalendar } from '@/components/performer/pipeline-calendar-analytics';

export const metadata = { title: 'Calendar' };

export default function CalendarPage({ params }: { params: { id: string } }) {
  return <StudioCalendar performerId={params.id} />;
}
