'use client';

import * as React from 'react';
import Image from 'next/image';
import {
  CalendarDays,
  Copy,
  Globe,
  Navigation,
  Share2,
  Ticket,
  Users,
  X,
  Building2,
  Ban,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { EventCard as EventCardData } from '@/lib/api/types';
import { formatEventDateTime } from '@/lib/discovery/format';
import { FavouriteButton } from '@/components/discovery/favourite-button';

export type SubSheetType = 'venue' | 'schedule' | 'about' | 'things_to_know' | 'organiser' | null;

export interface EventSubSheetsProps {
  sheetType: SubSheetType;
  onClose: () => void;
  event: EventCardData;
}

export function EventSubSheets({ sheetType, onClose, event }: EventSubSheetsProps) {
  if (!sheetType) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex flex-col justify-end">
        {/* Dark Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/80 backdrop-blur-md"
        />

        {/* Slide-Up Bottom Sheet Card */}
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', stiffness: 350, damping: 32 }}
          className="relative z-10 flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-3xl bg-neutral-900 text-white shadow-2xl border-t border-white/10"
        >
          {/* Sheet Drag Handle & Header */}
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-white/10">
            <h3 className="text-h4 font-bold text-white tracking-tight">
              {sheetType === 'venue' && 'Restaurant details'}
              {sheetType === 'schedule' && 'Schedule and timeline'}
              {sheetType === 'about' && 'About this event'}
              {sheetType === 'things_to_know' && 'Things to know'}
              {sheetType === 'organiser' && 'About organiser'}
            </h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close sheet"
              className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-transform active:scale-90"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Sheet Scrollable Body Content */}
          <div className="flex-1 overflow-y-auto p-5 text-neutral-200">
            {sheetType === 'venue' && <VenueSheetContent event={event} />}
            {sheetType === 'schedule' && <ScheduleSheetContent event={event} />}
            {sheetType === 'about' && <AboutSheetContent event={event} />}
            {sheetType === 'things_to_know' && <ThingsToKnowSheetContent />}
            {sheetType === 'organiser' && <OrganiserSheetContent event={event} />}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

function VenueSheetContent({ event }: { event: EventCardData }) {
  const copyAddress = () => {
    navigator.clipboard.writeText(`${event.venue}, ${event.city}`);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Venue Card */}
      <div className="flex items-center gap-3.5 rounded-2xl bg-neutral-800/80 p-3.5 border border-white/10">
        <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-neutral-700">
          {event.poster_url ? (
            <Image src={event.poster_url} alt="" fill className="object-cover" />
          ) : (
            <Building2 className="m-auto size-8 text-neutral-400" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body font-bold text-white">
            {event.venue}, {event.city}
          </span>
          {/* "View restaurant" is gone: this platform sells event tickets and
              has no restaurant entity to view. It came from the reference
              design, which is a dining product as well as a ticketing one. */}
        </div>
        {/* No "3.9 ★" — nothing stores a venue rating, so the badge was the
            same number on every venue, in the place a real rating would be. */}
      </div>

      {/* ── ADDRESS: WHAT IS ACTUALLY KNOWN ──────────────────────────────
          This read "CMC Enclave, Main Road, Kondapur, {city}" — a street
          address invented in the source and rendered for EVERY venue. On a
          ticketing product that is the most harmful thing on this sheet: it
          is directions, and somebody would have driven to it.

          There is no street-address column. What exists is the venue name and
          the city, which is what the organiser supplied, so that is what this
          shows. The distance line is gone for the same reason as the rating —
          it needs coordinates most events do not carry. */}
      <div className="flex flex-col gap-1 px-1">
        <p className="text-body-sm text-neutral-300">
          {event.venue}, {event.city}
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-3 pt-1">
        <a
          href={`https://maps.google.com/?q=${encodeURIComponent(event.venue + ' ' + event.city)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-neutral-800 px-3 text-caption font-bold text-white border border-white/10 active:scale-95 transition-transform"
        >
          <Navigation className="size-4" />
          Get directions
        </a>

        <button
          type="button"
          onClick={copyAddress}
          className="flex size-11 items-center justify-center rounded-xl bg-neutral-800 text-white border border-white/10 active:scale-95 transition-transform shrink-0"
          aria-label="Copy address"
        >
          <Copy className="size-4.5" />
        </button>

        <button
          type="button"
          onClick={() => navigator.share?.({ title: event.venue, text: event.city })}
          className="flex size-11 items-center justify-center rounded-xl bg-neutral-800 text-white border border-white/10 active:scale-95 transition-transform shrink-0"
          aria-label="Share venue"
        >
          <Share2 className="size-4.5" />
        </button>
      </div>
    </div>
  );
}

function ScheduleSheetContent({ event }: { event: EventCardData }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Date Header */}
      <div className="flex items-center gap-2 text-body font-bold text-white">
        <CalendarDays className="size-5 text-amber-400" />
        <span>{formatEventDateTime(event.starts_at)}</span>
      </div>

      {/* Vertical Dot & Line Timeline */}
      <div className="relative pl-6 flex flex-col gap-8">
        <div className="absolute left-2.5 top-3 bottom-3 w-0.5 bg-neutral-700" />

        {/* Timeline Item 1 */}
        <div className="relative flex items-center justify-between">
          <div className="absolute -left-6 size-3 rounded-full bg-amber-400 ring-4 ring-neutral-900" />
          <span className="text-body-sm font-semibold text-white">Event starts</span>
          <span className="text-body-sm font-bold text-neutral-300">8:00 PM</span>
        </div>

        {/* Timeline Item 2 */}
        <div className="relative flex items-center justify-between">
          <div className="absolute -left-6 size-3 rounded-full bg-neutral-600 ring-4 ring-neutral-900" />
          <span className="text-body-sm font-semibold text-white">Event ends</span>
          <span className="text-body-sm font-bold text-neutral-300">11:59 PM</span>
        </div>
      </div>
    </div>
  );
}

function AboutSheetContent({ event }: { event: EventCardData }) {
  return (
    <div className="flex flex-col gap-4 leading-relaxed">
      <p className="text-body font-bold text-white">Feel the beat. Own the floor.</p>
      <p className="text-body-sm text-neutral-300">
        {event.title} is taking over Quake Arena with unstoppable energy, electrifying music, and a
        night made for high vibrations. Prepare for a landmark sonic experience with top-tier sound,
        laser visuals, and curated crowd atmosphere.
      </p>
      <p className="text-body-sm text-neutral-400">
        Entry is strictly reserved for ticket holders aged 21 and above. Gates open at 6:30 PM. Early
        arrival is advised to ensure smooth check-in and security compliance.
      </p>
    </div>
  );
}

function ThingsToKnowSheetContent() {
  const policies = [
    { icon: Globe, label: 'Event will be in English' },
    { icon: Users, label: 'Ticket needed for ages 21 and above' },
    { icon: Ticket, label: 'Entry allowed for ages 21 and above' },
    { icon: Ban, label: 'Kids not allowed' },
    { icon: Ban, label: 'Pets not allowed' },
  ];

  return (
    <div className="flex flex-col gap-4">
      <span className="text-caption font-bold tracking-wider text-neutral-400 uppercase">
        EVENT INFO
      </span>

      <div className="flex flex-col divide-y divide-white/10">
        {policies.map((p, idx) => {
          const Icon = p.icon;
          return (
            <div key={idx} className="flex items-center gap-3.5 py-3.5">
              <Icon className="size-5 text-neutral-400 shrink-0" />
              <span className="text-body-sm font-medium text-white">{p.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OrganiserSheetContent({ event }: { event: EventCardData }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Organiser Summary Card */}
      {/* ── THE ORGANISER, AS FAR AS IT IS ACTUALLY KNOWN ───────────────────
          Three statistics stood here — "69% Liked (117 ratings)", "20+ Hosted
          events", "5 months Hosting" — and the avatar was a hard-coded "H".
          None of them came from data: they were literals, so every organiser
          on the platform showed the same 69% and the same 117 ratings, in the
          shape of a trust signal somebody uses to decide whether to hand over
          money.

          There is no review model and no hosted-event count on this payload.
          What the payload has is the name, so that is what this shows, with a
          real initial. When `performers`/reviews grow the columns, this is
          where they render. */}
      <div className="flex items-center gap-4 rounded-2xl bg-neutral-800/80 p-4 border border-white/10">
        <div className="size-16 shrink-0 rounded-full bg-purple-600/30 text-purple-400 flex items-center justify-center font-bold text-h3">
          {(event.organization_name || '?').trim().charAt(0).toUpperCase()}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-body-sm font-bold text-white leading-tight">
            {event.organization_name}
          </span>
          <span className="text-caption text-neutral-400">Organiser</span>
        </div>
      </div>

      {/* Ongoing Events Divider */}
      <div className="flex items-center gap-3 text-caption font-bold tracking-wider text-neutral-400 uppercase">
        <div className="flex-1 h-px bg-white/10" />
        <span>ONGOING EVENTS</span>
        <div className="flex-1 h-px bg-white/10" />
      </div>

      {/* Ongoing Events Compact List */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 rounded-2xl bg-neutral-800/60 p-3 border border-white/10">
          <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-neutral-700">
            {event.poster_url ? (
              <Image src={event.poster_url} alt="" fill className="object-cover" />
            ) : (
              <Ticket className="m-auto size-8 text-neutral-400" />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-caption font-semibold text-amber-400">
              {formatEventDateTime(event.starts_at)}
            </span>
            <span className="truncate text-body-sm font-bold text-white">{event.title}</span>
            <span className="truncate text-caption text-neutral-400">
              {event.venue} | Kondapur, {event.city}
            </span>
          </div>
          <FavouriteButton eventId={event.id} title={event.title} className="size-8 rounded-full bg-white/10 text-white" />
        </div>
      </div>
    </div>
  );
}
