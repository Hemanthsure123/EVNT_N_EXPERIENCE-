import type { Meta, StoryObj } from '@storybook/react';
import { Checkbox } from './checkbox';
import { Label } from './label';
import { RadioGroup, RadioGroupItem } from './radio';
import { Switch } from './switch';

const meta: Meta = {
  title: 'UI/Form controls',
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj;

export const Checkboxes: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-body-sm">
        <Checkbox defaultChecked /> Email me updates
      </label>
      <label className="flex items-center gap-2 text-body-sm">
        <Checkbox /> Send SMS reminders
      </label>
      <label className="flex items-center gap-2 text-body-sm opacity-60">
        <Checkbox disabled /> Disabled option
      </label>
    </div>
  ),
};

export const Switches: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Switch id="sw" defaultChecked />
      <Label htmlFor="sw">WhatsApp reminders</Label>
    </div>
  ),
};

export const Radios: Story = {
  render: () => (
    <RadioGroup defaultValue="gold" className="flex gap-4">
      {['basic', 'gold', 'premium'].map((t) => (
        <label key={t} className="flex items-center gap-2 text-body-sm capitalize">
          <RadioGroupItem value={t} /> {t}
        </label>
      ))}
    </RadioGroup>
  ),
};
