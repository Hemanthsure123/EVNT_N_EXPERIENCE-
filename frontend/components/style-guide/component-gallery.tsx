'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { CalendarClock, Heart, Music, Search, Ticket } from 'lucide-react';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Chip } from '@/components/ui/chip';
import { Combobox } from '@/components/ui/combobox';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import {
  Modal,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
} from '@/components/ui/modal';
import { Pagination } from '@/components/ui/pagination';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toast';
import { Label } from '@/components/ui/label';
import { Section, Subsection } from './section';

const CITY_OPTIONS = [
  { value: 'mumbai', label: 'Mumbai' },
  { value: 'delhi', label: 'Delhi' },
  { value: 'bengaluru', label: 'Bengaluru' },
  { value: 'hyderabad', label: 'Hyderabad' },
  { value: 'chennai', label: 'Chennai' },
];

const emailSchema = z.object({ email: z.string().email('Enter a valid email address') });
type EmailForm = z.infer<typeof emailSchema>;

export function ComponentGallery() {
  const { toast } = useToast();
  const [chips, setChips] = React.useState<string[]>(['music']);
  const [pageIndex, setPageIndex] = React.useState(1);
  const [city, setCity] = React.useState<string>();
  const [tier, setTier] = React.useState('gold');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitSuccessful },
  } = useForm<EmailForm>({ resolver: zodResolver(emailSchema) });

  const toggleChip = (value: string) =>
    setChips((prev) => (prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]));

  return (
    <div className="flex flex-col gap-16">
      <Section
        id="buttons"
        title="Buttons"
        description="Variants, sizes, and states — all token-driven with a visible focus ring and press feedback."
      >
        <Subsection title="Variants">
          <div className="flex flex-wrap items-center gap-3">
            <Button emphasis>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
          </div>
        </Subsection>
        <Subsection title="Sizes, icons & states">
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" aria-label="Like">
              <Heart className="size-5" aria-hidden />
            </Button>
            <Button leftIcon={<Ticket className="size-4" aria-hidden />}>Get tickets</Button>
            <Button loading>Processing</Button>
            <Button disabled>Disabled</Button>
          </div>
        </Subsection>
      </Section>

      <Section
        id="badges"
        title="Badges & chips"
        description="Status badges and selectable filter chips."
      >
        <Subsection title="Badges">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Default</Badge>
            <Badge variant="primary">Selling fast</Badge>
            <Badge variant="success">Paid</Badge>
            <Badge variant="warning">Few left</Badge>
            <Badge variant="destructive">Sold out</Badge>
            <Badge variant="info">New</Badge>
            <Badge variant="accent">Featured</Badge>
            <Badge variant="outline">Free</Badge>
          </div>
        </Subsection>
        <Subsection title="Filter chips (selectable)">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { value: 'music', label: 'Music', icon: <Music className="size-4" aria-hidden /> },
              { value: 'comedy', label: 'Comedy' },
              { value: 'workshops', label: 'Workshops' },
              { value: 'sports', label: 'Sports' },
            ].map((c) => (
              <Chip
                key={c.value}
                selected={chips.includes(c.value)}
                onClick={() => toggleChip(c.value)}
              >
                {c.icon}
                {c.label}
              </Chip>
            ))}
          </div>
        </Subsection>
      </Section>

      <Section
        id="forms"
        title="Forms"
        description="Inputs wrapped in FormField (label + description + inline error), plus react-hook-form + zod validation."
      >
        <div className="grid gap-6 md:grid-cols-2">
          <FormField label="Full name" htmlFor="sg-name" description="As it appears on your ID.">
            <Input id="sg-name" placeholder="Ada Lovelace" />
          </FormField>
          <FormField label="Email" htmlFor="sg-email-bad" error="Enter a valid email address">
            <Input id="sg-email-bad" defaultValue="not-an-email" invalid />
          </FormField>
          <FormField label="City" htmlFor="sg-city">
            <Combobox
              id="sg-city"
              options={CITY_OPTIONS}
              value={city}
              onValueChange={setCity}
              placeholder="Choose a city"
            />
          </FormField>
          <FormField label="Ticket tier" htmlFor="sg-select">
            <Select defaultValue="gold">
              <SelectTrigger id="sg-select">
                <SelectValue placeholder="Select a tier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="basic">Basic</SelectItem>
                <SelectItem value="gold">Gold</SelectItem>
                <SelectItem value="premium">Premium</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Message" htmlFor="sg-textarea" className="md:col-span-2">
            <Textarea id="sg-textarea" placeholder="Tell us about your event…" />
          </FormField>
        </div>

        <Subsection title="Choice controls">
          <div className="flex flex-wrap items-center gap-8">
            <label className="flex items-center gap-2 text-body-sm">
              <Checkbox defaultChecked /> Email me updates
            </label>
            <div className="flex items-center gap-2 text-body-sm">
              <Switch id="sg-switch" defaultChecked />
              <Label htmlFor="sg-switch">WhatsApp reminders</Label>
            </div>
            <RadioGroup value={tier} onValueChange={setTier} className="flex gap-4">
              {['basic', 'gold', 'premium'].map((t) => (
                <label key={t} className="flex items-center gap-2 text-body-sm capitalize">
                  <RadioGroupItem value={t} /> {t}
                </label>
              ))}
            </RadioGroup>
          </div>
        </Subsection>

        <Subsection title="Validated form (react-hook-form + zod)">
          <form
            noValidate
            onSubmit={handleSubmit(() => toast({ title: 'Subscribed!', variant: 'success' }))}
            className="flex max-w-md flex-col gap-3"
          >
            <FormField label="Email" htmlFor="sg-rhf-email" error={errors.email?.message}>
              <Input id="sg-rhf-email" placeholder="you@example.com" {...register('email')} />
            </FormField>
            <Button type="submit" className="self-start">
              Subscribe
            </Button>
            {isSubmitSuccessful ? (
              <p className="text-body-sm text-success">Thanks — check your inbox.</p>
            ) : null}
          </form>
        </Subsection>
      </Section>

      <Section
        id="cards"
        title="Cards"
        description="The 20px card radius with soft elevation; interactive cards lift on hover."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Static card</CardTitle>
              <CardDescription>Surface, border, and soft shadow from tokens.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-body-sm text-muted-foreground">
                Cards compose a header, content, and footer — the base for event, ticket, and KPI
                cards.
              </p>
            </CardContent>
            <CardFooter>
              <Button size="sm">Action</Button>
              <Button size="sm" variant="ghost">
                Cancel
              </Button>
            </CardFooter>
          </Card>
          <Card interactive>
            <CardHeader>
              <CardTitle>Interactive card</CardTitle>
              <CardDescription>Hover me — the signature lift (§10.3).</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Avatar>
                  <AvatarImage src="" alt="" />
                  <AvatarFallback>EE</AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-body-sm font-medium">Eventful Collective</p>
                  <p className="text-caption text-muted-foreground">Verified organizer</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section id="tabs" title="Tabs" description="Keyboard-navigable segmented control.">
        <Tabs defaultValue="overview" className="max-w-md">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="tickets">Tickets</TabsTrigger>
            <TabsTrigger value="reviews">Reviews</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="text-body-sm text-muted-foreground">
            Event overview, description, and details.
          </TabsContent>
          <TabsContent value="tickets" className="text-body-sm text-muted-foreground">
            Tier selection and availability.
          </TabsContent>
          <TabsContent value="reviews" className="text-body-sm text-muted-foreground">
            Attendee ratings and reviews.
          </TabsContent>
        </Tabs>
      </Section>

      <Section
        id="overlays"
        title="Overlays & feedback"
        description="Modal, drawer, tooltip, and toast — all focus-trapped and keyboard-dismissible."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Modal>
            <ModalTrigger asChild>
              <Button variant="outline">Open modal</Button>
            </ModalTrigger>
            <ModalContent>
              <ModalHeader>
                <ModalTitle>Confirm your booking</ModalTitle>
                <ModalDescription>
                  Your tickets are held for 10 minutes while you complete payment.
                </ModalDescription>
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

          <Drawer>
            <DrawerTrigger asChild>
              <Button variant="outline">Open drawer</Button>
            </DrawerTrigger>
            <DrawerContent side="right">
              <DrawerTitle>Filters</DrawerTitle>
              <DrawerDescription>Refine events by date, price, and category.</DrawerDescription>
            </DrawerContent>
          </Drawer>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Add to calendar">
                <CalendarClock className="size-5" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Add to calendar</TooltipContent>
          </Tooltip>

          <Button
            onClick={() =>
              toast({
                title: 'Ticket issued',
                description: 'Check your email for the QR.',
                variant: 'success',
              })
            }
          >
            Show toast
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              toast({
                title: 'Payment failed',
                description: 'Please try another method.',
                variant: 'destructive',
              })
            }
          >
            Error toast
          </Button>
        </div>

        <div className="grid gap-3">
          <Alert variant="info">
            <AlertTitle>Heads up</AlertTitle>
            <AlertDescription>Cashfree is coming soon — Razorpay is active today.</AlertDescription>
          </Alert>
          <Alert variant="success">
            <AlertTitle>You&rsquo;re in</AlertTitle>
            <AlertDescription>Entry confirmed at Gate North.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <AlertTitle>Sold out</AlertTitle>
            <AlertDescription>This tier is no longer available.</AlertDescription>
          </Alert>
        </div>
      </Section>

      <Section
        id="states"
        title="Loading, empty & navigation"
        description="Skeletons shaped like content, spinners, empty states, breadcrumbs, and pagination."
      >
        <Subsection title="Skeleton & spinner">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex w-full max-w-xs flex-col gap-3">
              <Skeleton className="aspect-video rounded-xl" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
            <Spinner />
          </div>
        </Subsection>
        <Subsection title="Empty state">
          <EmptyState
            icon={<Search className="size-8" aria-hidden />}
            title="No results found"
            description="Try adjusting your filters or searching a different city."
            action={<Button variant="outline">Clear filters</Button>}
          />
        </Subsection>
        <Subsection title="Breadcrumb & pagination">
          <Breadcrumb
            items={[
              { label: 'Home', href: '/' },
              { label: 'Events', href: '/events' },
              { label: 'Mumbai' },
            ]}
          />
          <Pagination
            hasPrevious={pageIndex > 1}
            hasNext={pageIndex < 3}
            onPrevious={() => setPageIndex((p) => Math.max(1, p - 1))}
            onNext={() => setPageIndex((p) => Math.min(3, p + 1))}
            label={`Page ${pageIndex} of 3`}
          />
        </Subsection>
      </Section>
    </div>
  );
}
