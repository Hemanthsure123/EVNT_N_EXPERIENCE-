import * as React from 'react';
import { Container } from '@/components/shell/container';
import { CreateAct } from '@/components/performer/create-act';

export const metadata = { title: 'List your act' };

export default function NewActPage() {
  return (
    <Container>
      <CreateAct />
    </Container>
  );
}
