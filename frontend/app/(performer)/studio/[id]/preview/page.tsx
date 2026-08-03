import * as React from 'react';
import { ProfilePreview } from '@/components/performer/profile-preview';

export const metadata = { title: 'Preview' };

export default function PreviewPage({ params }: { params: { id: string } }) {
  return <ProfilePreview performerId={params.id} />;
}
