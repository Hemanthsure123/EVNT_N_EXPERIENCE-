import * as React from 'react';
import type { Metadata } from 'next';
import { AnnouncementsAdmin } from '@/components/admin/announcements-admin';

export const metadata: Metadata = { title: 'Announcements' };

export default function AdminAnnouncementsPage() {
  return <AnnouncementsAdmin />;
}
