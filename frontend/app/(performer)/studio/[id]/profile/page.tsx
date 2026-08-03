import * as React from 'react';
import { ProfileEditor } from '@/components/performer/profile-editor';

export const metadata = { title: 'Profile' };

export default function ProfilePage({ params }: { params: { id: string } }) {
  return <ProfileEditor performerId={params.id} />;
}
