import { AdminEventAnalytics } from '@/components/admin/event-analytics';

export default function AdminEventAnalyticsPage({ params }: { params: { id: string } }) {
  return <AdminEventAnalytics eventId={params.id} />;
}
