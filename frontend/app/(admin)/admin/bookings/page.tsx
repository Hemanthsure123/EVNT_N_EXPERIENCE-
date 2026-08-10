import * as React from 'react';
import { SupportDesk } from '@/components/admin/support-desk';

export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <SupportDesk />
    </React.Suspense>
  );
}
