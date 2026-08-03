import * as React from 'react';
import { OrganizationsList } from '@/components/admin/lists';

export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <OrganizationsList />
    </React.Suspense>
  );
}
