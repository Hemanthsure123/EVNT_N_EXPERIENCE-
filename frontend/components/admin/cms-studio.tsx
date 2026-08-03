'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ExternalLink,
  LayoutGrid,
  LayoutTemplate,
  MapPin,
  Megaphone,
  Monitor,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Tag,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import {
  createFeaturedCity,
  createPopularSearch,
  deleteFeaturedCity,
  deletePopularSearch,
  fetchAdminCategories,
  fetchAdminFeaturedCities,
  fetchAdminPopularSearches,
  fetchHomepageDraft,
  updateFeaturedCity,
  updatePopularSearch,
  type AdminFeaturedCity,
  type AdminPopularSearch,
  type HomepageDraft,
} from '@/lib/api/cms';
import { CuratedListEditor } from './curated-list';
import { ErrorState, Skeleton } from '@/components/organizer/primitives';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { HomepageCms } from './homepage-cms';
import { FeaturedManager } from './featured-manager';
import { AnnouncementsAdmin } from './announcements-admin';

/**
 * The CMS Studio.
 *
 * ── THREE PANES: TREE | PREVIEW | EDITOR ──────────────────────────────────
 *
 * The tree on the left is the PAGE, not a menu — its rows are the sections a
 * visitor scrolls past, in the order they appear. Selecting one scrolls the
 * preview to it and swaps the editor, so "where does this text end up" never
 * needs answering.
 *
 * ── THE PREVIEW IS THE REAL PAGE, IN AN IFRAME ────────────────────────────
 *
 * Not a hand-built mock of it. A mock is a second implementation of the
 * homepage that drifts from the first, and the whole value of a preview is
 * that it is not a drawing. The trade is that it shows what is PUBLISHED
 * rather than what is typed — there is no draft/preview endpoint, so the
 * server has nothing to render an unsaved version from. The pane says so
 * plainly and refreshes on save, rather than pretending to be live.
 *
 * A true type-and-see preview needs a draft mode: a `?preview=<token>` route
 * that renders unsaved content for a staff caller. BACKLOG item 57.
 *
 * ── WHAT THE TREE DOES NOT CONTAIN ────────────────────────────────────────
 *
 * The brief listed Cities, Trending, Footer and Banners as editable. Of those:
 * the footer note IS editable (it is a field on the homepage record) and is in
 * the tree. **Cities, Trending and Banners are not** — there is no City model,
 * no trending collection with anything writing to it, and no Banner model. A
 * tree row that opens an editor saving nowhere is worse than an absent row,
 * because an operator would believe the site had been changed. BACKLOG item
 * 58.
 *
 * ── THE CHROME IS QUIET SO THE EDITOR IS NOT ──────────────────────────────
 *
 * Nothing in this frame is a filled button. The tree's selected row wears the
 * warm `--nav-active` pill ("you are here"), the device toggle's selected half
 * wears the same, and "Open the live site" is an outline button — because the
 * ONE near-black action on this screen belongs to whichever editor is loaded
 * in the middle pane, and it is the operator's actual task. Two filled pills
 * on a page is two things claiming to be the point.
 */

type SectionId =
  | 'hero'
  | 'search'
  | 'ribbon'
  | 'trust'
  | 'featured'
  | 'categories'
  | 'cities'
  | 'popular'
  | 'footer'
  | 'announcements';

type TreeNode = {
  id: SectionId;
  label: string;
  icon: LucideIcon;
  /** What a visitor sees, so the tree reads as the page rather than as config. */
  blurb: string;
  /** The preview's anchor. Empty when the section has no DOM landmark. */
  anchor?: string;
};

const TREE: TreeNode[] = [
  { id: 'hero', label: 'Hero', icon: Sparkles, blurb: 'Headline, description, two buttons' },
  { id: 'search', label: 'Search bar', icon: Search, blurb: 'Placeholder text' },
  { id: 'ribbon', label: 'Ribbon', icon: Megaphone, blurb: 'The strip above the hero' },
  { id: 'trust', label: 'Trust badges', icon: ShieldCheck, blurb: 'Short claims under the hero' },
  { id: 'featured', label: 'Featured events', icon: Star, blurb: 'Curated rails, in order' },
  { id: 'categories', label: 'Categories', icon: Tag, blurb: 'The browse tiles' },
  { id: 'cities', label: 'Featured cities', icon: MapPin, blurb: 'Cities promoted on the home page' },
  {
    id: 'popular',
    label: 'Popular searches',
    icon: TrendingUp,
    blurb: 'Suggested searches in the search panel',
  },
  { id: 'footer', label: 'Footer note', icon: LayoutTemplate, blurb: 'One line at the bottom' },
  {
    id: 'announcements',
    label: 'Announcements',
    icon: Megaphone,
    blurb: 'Site-wide notices, scheduled',
  },
];

export function CmsStudio() {
  const [selected, setSelected] = React.useState<SectionId>('hero');
  const [device, setDevice] = React.useState<'desktop' | 'mobile'>('desktop');
  const [previewKey, setPreviewKey] = React.useState(0);

  const draft = useQuery({ queryKey: ['admin', 'homepage-draft'], queryFn: fetchHomepageDraft });
  const categories = useQuery({ queryKey: ['admin', 'categories'], queryFn: fetchAdminCategories });

  return (
    <div className="flex flex-col gap-block">
      <header className="flex flex-wrap items-end justify-between gap-stack-lg">
        <div className="min-w-0">
          <h1 className="text-h3">Studio</h1>
          <p className="text-body-sm text-muted-foreground">
            Everything on the front page, in the order a visitor meets it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DeviceToggle device={device} onChange={setDevice} />
          <Button asChild variant="outline">
            <Link href="/" target="_blank" rel="noopener noreferrer">
              Open the live site
              <ExternalLink className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </header>

      {/* Three columns above `2xl`, two above `lg`, one stacked below — the
          preview is the first thing to go, because on a narrow screen it is
          smaller than the thing it previews. */}
      <div className="grid gap-block lg:grid-cols-[15rem_minmax(0,1fr)] 2xl:grid-cols-[15rem_minmax(0,1fr)_minmax(0,1.1fr)]">
        <Tree
          selected={selected}
          onSelect={setSelected}
          draft={draft.data}
          categoryCount={categories.data?.data.filter((row) => !row.archived_at).length ?? 0}
        />

        <section className="min-w-0" aria-label="Editor">
          {draft.isError ? (
            <ErrorState
              message="Could not load the homepage content."
              onRetry={() => void draft.refetch()}
              className="rounded-xl border border-border bg-surface"
            />
          ) : (
            <Editor section={selected} onSaved={() => setPreviewKey((key) => key + 1)} />
          )}
        </section>

        <section className="hidden min-w-0 2xl:block" aria-label="Preview">
          <Preview device={device} refreshKey={previewKey} anchor={undefined} />
        </section>
      </div>
    </div>
  );
}

function Tree({
  selected,
  onSelect,
  draft,
  categoryCount,
}: {
  selected: SectionId;
  onSelect: (id: SectionId) => void;
  draft: HomepageDraft | undefined;
  categoryCount: number;
}) {
  // The tree shows the CURRENT value beside each row, so an operator can see
  // what is live without opening every section. That is the difference between
  // a content tree and a settings menu.
  const summary: Partial<Record<SectionId, string>> = {
    hero: draft?.hero_headline,
    search: draft?.search_placeholder,
    ribbon: draft?.ribbon_enabled ? draft.ribbon_text : 'Hidden',
    trust: draft ? `${draft.trust_badges.length} badge${draft.trust_badges.length === 1 ? '' : 's'}` : undefined,
    categories: `${categoryCount} live`,
    footer: draft?.footer_note,
  };

  return (
    <nav aria-label="Page sections" className="min-w-0">
      <ol className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {TREE.map((node, index) => {
          const active = selected === node.id;
          return (
            <li key={node.id} className="shrink-0 lg:shrink">
              <button
                type="button"
                onClick={() => onSelect(node.id)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  // `min-h-control` because below `lg` this list is a
                  // horizontally scrolling strip of taps, not a sidebar.
                  'flex min-h-control w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-fast',
                  'motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  // The warm butter pill is the console's "you are here". It is
                  // deliberately not the brand violet: a selected row must not
                  // read as a button waiting to be pressed.
                  active
                    ? 'bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <span
                  className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center text-caption tabular-nums"
                  aria-hidden
                >
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <node.icon className="size-4 shrink-0" aria-hidden />
                    <span className="truncate text-label">{node.label}</span>
                  </span>
                  {/* The current value, not a description — that is what makes
                      this a content tree rather than a settings menu. */}
                  <span className="hidden truncate text-caption lg:block">
                    {summary[node.id] || node.blurb}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The editor pane.
 *
 * Hero, search, ribbon, trust and footer are all fields on ONE homepage record
 * with ONE optimistic-lock version, so they share one form — splitting them
 * into five forms would mean five versions of the same row racing each other.
 * The form scrolls to the chosen section rather than filtering to it, which
 * keeps a single Save for a single write.
 */
function Editor({ section, onSaved }: { section: SectionId; onSaved: () => void }) {
  if (section === 'featured') return <FeaturedManager />;
  if (section === 'announcements') return <AnnouncementsAdmin />;
  if (section === 'cities') {
    return (
      <CuratedListEditor
        queryKey={['admin', 'featured-cities']}
        fetchAll={fetchAdminFeaturedCities}
        create={createFeaturedCity as (input: Record<string, unknown>) => Promise<AdminFeaturedCity>}
        update={
          updateFeaturedCity as (id: string, input: Record<string, unknown>) => Promise<AdminFeaturedCity>
        }
        remove={deleteFeaturedCity}
        primaryField="name"
        title="Featured cities"
        blurb="The cities promoted on the home page, in order. This is NOT the list of cities the platform supports — every city with an event in it is already searchable and already has a landing page."
        addLabel="Add city"
        fields={[
          {
            key: 'name',
            label: 'City',
            placeholder: 'Mumbai',
            hint: 'Must match the city on events exactly, or the tile leads to an empty page.',
          },
          {
            key: 'image_url',
            label: 'Image URL',
            placeholder: 'https://…',
            hint: 'Optional.',
            required: false,
          },
        ]}
      />
    );
  }
  if (section === 'popular') {
    return (
      <CuratedListEditor
        queryKey={['admin', 'popular-searches']}
        fetchAll={fetchAdminPopularSearches}
        create={
          createPopularSearch as (input: Record<string, unknown>) => Promise<AdminPopularSearch>
        }
        update={
          updatePopularSearch as (id: string, input: Record<string, unknown>) => Promise<AdminPopularSearch>
        }
        remove={deletePopularSearch}
        primaryField="label"
        title="Popular searches"
        blurb="Suggested searches shown when the search panel opens. These are a CURATION decision — the platform keeps no search-term log, so nothing here is a measurement."
        addLabel="Add search"
        fields={[
          { key: 'label', label: 'Chip text', placeholder: 'Comedy nights' },
          {
            key: 'query',
            label: 'Searches for',
            placeholder: 'comedy',
            hint: 'What pressing the chip actually searches. Kept separate so the chip can read well.',
          },
        ]}
      />
    );
  }
  return <HomepageCms focus={section} onSaved={onSaved} />;
}

function DeviceToggle({
  device,
  onChange,
}: {
  device: 'desktop' | 'mobile';
  onChange: (device: 'desktop' | 'mobile') => void;
}) {
  return (
    // A segmented control, not two buttons: one pill-shaped well with the
    // chosen half filled in the console's "selected" butter.
    <div
      role="group"
      aria-label="Preview width"
      className="hidden items-center gap-1 rounded-full border border-border bg-sunken p-1 2xl:flex"
    >
      {(
        [
          { value: 'desktop', icon: Monitor, label: 'Desktop' },
          { value: 'mobile', icon: Smartphone, label: 'Mobile' },
        ] as const
      ).map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={device === option.value}
          aria-label={option.label}
          title={option.label}
          className={cn(
            'inline-flex size-control-sm items-center justify-center rounded-full transition-colors duration-fast',
            'motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            device === option.value
              ? 'bg-nav-active text-nav-active-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <option.icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  );
}

/**
 * The live site, in an iframe.
 *
 * ── IT SHOWS WHAT IS PUBLISHED, AND SAYS SO ───────────────────────────────
 *
 * There is no draft-render endpoint, so the server can only produce the saved
 * version. Rather than imply otherwise, the pane is labelled "Published" and
 * reloads on save. An operator who types a headline and watches this NOT
 * change has been told why, which is much better than a preview that lies for
 * three seconds and then catches up.
 *
 * ── SANDBOXED, AND SAME-ORIGIN ────────────────────────────────────────────
 *
 * `sandbox` without `allow-same-origin` would break the site's own scripts and
 * fonts; keeping it same-origin is safe here because the framed page is our
 * own. `allow-scripts` is required for the homepage's client islands to
 * render at all — a preview of a page with its interactivity stripped is a
 * preview of a different page.
 */
function Preview({
  device,
  refreshKey,
  anchor,
}: {
  device: 'desktop' | 'mobile';
  refreshKey: number;
  anchor?: string;
}) {
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => setLoading(true), [refreshKey]);

  return (
    <div className="sticky top-sticky-top flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-body-sm font-semibold text-foreground">Preview</h2>
        <p className="text-caption text-muted-foreground">Published version — refreshes on save</p>
      </div>

      <div
        className={cn(
          'relative overflow-hidden rounded-xl border border-border bg-surface',
          device === 'mobile' ? 'mx-auto w-[24rem] max-w-full' : 'w-full',
        )}
      >
        {loading ? (
          <Skeleton className="absolute inset-0 z-10" />
        ) : null}
        <iframe
          key={refreshKey}
          src={anchor ? `/#${anchor}` : '/'}
          title="Homepage preview"
          onLoad={() => setLoading(false)}
          sandbox="allow-scripts allow-same-origin"
          className="h-[38rem] w-full border-0"
        />
      </div>

      <p className="text-caption text-muted-foreground">
        Typing does not update this — there is no draft-render endpoint, so the server can only
        show the saved version. BACKLOG item 57.
      </p>
    </div>
  );
}

/** A compact tile for the overview's CMS card. */
export function CmsSummary() {
  const draft = useQuery({ queryKey: ['admin', 'homepage-draft'], queryFn: fetchHomepageDraft });
  return (
    <Link
      href="/admin/homepage"
      className="flex items-start gap-stack rounded-xl border border-border bg-surface p-card transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <LayoutGrid className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0">
        <span className="block text-body-sm font-medium text-foreground">Front page</span>
        <span className="block truncate text-caption text-muted-foreground">
          {draft.data?.hero_headline ?? 'Loading…'}
        </span>
      </span>
    </Link>
  );
}
