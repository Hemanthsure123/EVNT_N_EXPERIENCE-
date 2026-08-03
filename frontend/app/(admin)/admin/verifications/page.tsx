import * as React from 'react';
import { VerificationsList } from '@/components/admin/lists';

export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <VerificationsList />
    </React.Suspense>
  );
}
