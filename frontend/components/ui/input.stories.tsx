import type { Meta, StoryObj } from '@storybook/react';
import { FormField } from './form-field';
import { Input } from './input';

const meta: Meta<typeof Input> = {
  title: 'UI/Input',
  component: Input,
  tags: ['autodocs'],
  args: { placeholder: 'you@example.com' },
};
export default meta;

type Story = StoryObj<typeof Input>;

export const Default: Story = {};
export const Invalid: Story = { args: { invalid: true, defaultValue: 'not-an-email' } };
export const Disabled: Story = { args: { disabled: true, defaultValue: 'Locked' } };

export const InFormField: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-4">
      <FormField label="Email" htmlFor="s-email" description="We'll send your tickets here.">
        <Input id="s-email" placeholder="you@example.com" />
      </FormField>
      <FormField label="Email" htmlFor="s-email-err" error="Enter a valid email address">
        <Input id="s-email-err" defaultValue="nope" invalid />
      </FormField>
    </div>
  ),
};
