import * as React from 'react';
import type { Metadata } from 'next';
import { AdminOrganizationDetail } from '@/components/admin/organization-detail';

/** `noindex` is inherited from the admin layout — this is one business's
 *  private trading data and must never reach a crawler. */
export const metadata: Metadata = { title: 'Organization' };

export default function AdminOrganizationPage({ params }: { params: { id: string } }) {
  return <AdminOrganizationDetail organizationId={params.id} />;
}
