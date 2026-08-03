import * as React from 'react';
import type { Metadata } from 'next';
import { SavedEvents } from '@/components/account/saved';

export const metadata: Metadata = { title: 'Saved' };

export default function AccountSavedPage() {
  return <SavedEvents />;
}
