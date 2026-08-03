import * as React from 'react';
import { PaymentsConsole } from '@/components/admin/payments';

export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <PaymentsConsole />
    </React.Suspense>
  );
}
