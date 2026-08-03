import * as React from 'react';
import { PhotoManager } from '@/components/performer/photo-manager';

export const metadata = { title: 'Photos' };

export default function PhotosPage({ params }: { params: { id: string } }) {
  return <PhotoManager performerId={params.id} />;
}
