import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';

const meta: Meta<typeof Card> = {
  title: 'UI/Card',
  component: Card,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof Card>;

export const Default: Story = {
  render: (args) => (
    <Card {...args} className="w-80">
      <CardHeader>
        <CardTitle>Summer Music Festival</CardTitle>
        <CardDescription>Sat 12 Jul · Phoenix Arena, Mumbai</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-body-sm text-muted-foreground">
          An open-air evening of live music across three stages.
        </p>
      </CardContent>
      <CardFooter>
        <Button size="sm">Get tickets</Button>
        <Button size="sm" variant="ghost">
          Details
        </Button>
      </CardFooter>
    </Card>
  ),
};

export const Interactive: Story = {
  args: { interactive: true },
  render: (args) => (
    <Card {...args} className="w-80">
      <CardHeader>
        <CardTitle>Hover me</CardTitle>
        <CardDescription>Interactive cards lift on hover.</CardDescription>
      </CardHeader>
    </Card>
  ),
};
