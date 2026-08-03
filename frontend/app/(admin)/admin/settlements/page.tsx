import * as React from 'react';
import { SettlementsList } from '@/components/admin/lists';

export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <SettlementsList />
    </React.Suspense>
  );
}
