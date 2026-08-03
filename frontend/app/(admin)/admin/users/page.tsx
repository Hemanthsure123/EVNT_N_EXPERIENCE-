import * as React from 'react';
import { UsersConsole } from '@/components/admin/users';

export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <UsersConsole />
    </React.Suspense>
  );
}
