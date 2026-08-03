import * as React from 'react';
import type { Metadata } from 'next';
import { ModerationQueue } from '@/components/admin/moderation';

export const metadata: Metadata = { title: 'Moderation' };

export default function AdminModerationQueuePage() {
  return <ModerationQueue />;
}
