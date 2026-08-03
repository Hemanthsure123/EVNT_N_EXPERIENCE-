import * as React from 'react';
import { Container } from '@/components/shell/container';
import { ActPicker } from '@/components/performer/act-picker';

export const metadata = { title: 'Your acts' };

export default function StudioIndexPage() {
  return (
    <Container>
      <ActPicker />
    </Container>
  );
}
