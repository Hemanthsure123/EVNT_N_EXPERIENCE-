import * as React from 'react';
import { CmsStudio } from '@/components/admin/cms-studio';

export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <CmsStudio />
    </React.Suspense>
  );
}
