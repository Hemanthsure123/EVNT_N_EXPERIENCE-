import type { Meta, StoryObj } from '@storybook/react';
import { Info } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from './alert';

const meta: Meta<typeof Alert> = {
  title: 'UI/Alert',
  component: Alert,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof Alert>;

export const All: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-3">
      <Alert variant="info" icon={<Info className="size-5" aria-hidden />}>
        <AlertTitle>Heads up</AlertTitle>
        <AlertDescription>Cashfree is coming soon — Razorpay is active today.</AlertDescription>
      </Alert>
      <Alert variant="success">
        <AlertTitle>You&rsquo;re in</AlertTitle>
        <AlertDescription>Entry confirmed at Gate North.</AlertDescription>
      </Alert>
      <Alert variant="warning">
        <AlertTitle>Few left</AlertTitle>
        <AlertDescription>Only a handful of Gold tickets remain.</AlertDescription>
      </Alert>
      <Alert variant="destructive">
        <AlertTitle>Sold out</AlertTitle>
        <AlertDescription>This tier is no longer available.</AlertDescription>
      </Alert>
    </div>
  ),
};
