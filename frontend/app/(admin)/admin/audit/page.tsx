import * as React from 'react';
import type { Metadata } from 'next';
import { AuditLog } from '@/components/admin/audit-log';

export const metadata: Metadata = { title: 'Audit log' };

export default function AdminAuditLogPage() {
  return <AuditLog />;
}
