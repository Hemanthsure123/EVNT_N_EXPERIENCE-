import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from './badge';

const meta: Meta<typeof Badge> = {
  title: 'UI/Badge',
  component: Badge,
  tags: ['autodocs'],
  args: { children: 'Selling fast' },
};
export default meta;

type Story = StoryObj<typeof Badge>;

export const All: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>Default</Badge>
      <Badge variant="primary">Selling fast</Badge>
      <Badge variant="accent">Featured</Badge>
      <Badge variant="success">Paid</Badge>
      <Badge variant="warning">Few left</Badge>
      <Badge variant="destructive">Sold out</Badge>
      <Badge variant="info">New</Badge>
      <Badge variant="outline">Free</Badge>
    </div>
  ),
};
