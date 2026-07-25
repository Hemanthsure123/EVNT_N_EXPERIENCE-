import type { Meta, StoryObj } from '@storybook/react';
import { CalendarClock } from 'lucide-react';
import { Button } from './button';
import { Combobox } from './combobox';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle, DrawerTrigger } from './drawer';
import {
  Modal,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
} from './modal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

const meta: Meta = { title: 'UI/Overlays & navigation', tags: ['autodocs'] };
export default meta;

type Story = StoryObj;

const CITIES = [
  { value: 'mumbai', label: 'Mumbai' },
  { value: 'delhi', label: 'Delhi' },
  { value: 'bengaluru', label: 'Bengaluru' },
];

export const ModalStory: Story = {
  name: 'Modal',
  render: () => (
    <Modal>
      <ModalTrigger asChild>
        <Button variant="outline">Open modal</Button>
      </ModalTrigger>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Confirm your booking</ModalTitle>
          <ModalDescription>Tickets are held for 10 minutes while you pay.</ModalDescription>
        </ModalHeader>
        <ModalFooter>
          <ModalClose asChild>
            <Button variant="ghost">Cancel</Button>
          </ModalClose>
          <ModalClose asChild>
            <Button emphasis>Continue</Button>
          </ModalClose>
        </ModalFooter>
      </ModalContent>
    </Modal>
  ),
};

export const DrawerStory: Story = {
  name: 'Drawer',
  render: () => (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant="outline">Open drawer</Button>
      </DrawerTrigger>
      <DrawerContent side="right">
        <DrawerTitle>Filters</DrawerTitle>
        <DrawerDescription>Refine by date, price, and category.</DrawerDescription>
      </DrawerContent>
    </Drawer>
  ),
};

export const SelectStory: Story = {
  name: 'Select',
  render: () => (
    <Select defaultValue="gold">
      <SelectTrigger className="w-64">
        <SelectValue placeholder="Select a tier" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="basic">Basic</SelectItem>
        <SelectItem value="gold">Gold</SelectItem>
        <SelectItem value="premium">Premium</SelectItem>
      </SelectContent>
    </Select>
  ),
};

export const ComboboxStory: Story = {
  name: 'Combobox',
  render: () => <Combobox options={CITIES} placeholder="Choose a city" className="w-64" />,
};

export const TabsStory: Story = {
  name: 'Tabs',
  render: () => (
    <Tabs defaultValue="overview" className="w-80">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="tickets">Tickets</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="text-body-sm text-muted-foreground">
        Event overview.
      </TabsContent>
      <TabsContent value="tickets" className="text-body-sm text-muted-foreground">
        Ticket tiers.
      </TabsContent>
    </Tabs>
  ),
};

export const TooltipStory: Story = {
  name: 'Tooltip',
  render: () => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Add to calendar">
            <CalendarClock className="size-5" aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Add to calendar</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
};
