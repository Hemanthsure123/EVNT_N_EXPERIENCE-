import { Bell, KeyRound, Palette, ShieldCheck, UserRound, type LucideIcon } from 'lucide-react';

/**
 * Which settings section is open, resolved from the URL.
 *
 * ── WHY THIS IS A PURE MODULE ─────────────────────────────────────────────
 *
 * The rules below are the ones a reader would not guess from the component,
 * and each fails SILENTLY rather than visibly: a hand-edited param that blanks
 * the page, or a Google Calendar callback whose banner lands on a section the
 * card is not rendered in. Both are one-line functions and neither is visible
 * by looking at a settings page that renders. Same reasoning as
 * `lib/discovery/calendar.ts` and `anchored-position.ts`.
 *
 * ── SECTION STATE LIVES IN THE URL ────────────────────────────────────────
 *
 * `?section=appearance`, not component state — the same rule every filter and
 * tab on this platform follows (design system §11.19). A settings link is then
 * shareable ("your theme is under this"), survives a reload, and Back steps
 * through sections instead of leaving the page.
 *
 * A nested route (`/account/settings/appearance`) would do the same, and was
 * not chosen for one reason: the backend's Google OAuth callback redirects to a
 * FIXED `/account/settings?calendar=…` (`apps/integrations/api.py`). With a
 * query param both facts live in the same URL and `resolveSection` can put the
 * person where the outcome is rendered; with a nested route the callback would
 * land on the index and the banner would be one navigation away from the
 * person who needs to read it.
 */

export type SettingsSectionId = 'profile' | 'appearance' | 'notifications' | 'privacy' | 'account';

export type SettingsSection = {
  id: SettingsSectionId;
  /** Nav label and card title. Sentence case, per §5.3. */
  label: string;
  /** The one line under the title — never empty; a card with no description
   *  makes the reader guess what the section is for. Asserted in the test. */
  description: string;
  icon: LucideIcon;
};

/**
 * The five sections, in the order they are drawn.
 *
 * Ordered by how often somebody arrives wanting it: what account am I signed
 * in as, then the two things that are genuinely adjustable, then the two that
 * are mostly statements of fact. `account` is last because its only action is
 * LEAVING, and a sign-out button at the top of a settings rail is an invitation
 * to misclick.
 *
 * Every entry here has a section that renders something REAL — see the audit in
 * `settings.tsx`. This list is not a menu of intentions.
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: 'profile',
    label: 'Profile',
    description: 'Your name, email address and how long you have been here',
    icon: UserRound,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'Light, dark or whatever this device prefers',
    icon: Palette,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'Reminders and messages',
    icon: Bell,
  },
  {
    id: 'privacy',
    label: 'Privacy & data',
    description: 'Cookies and saved events',
    icon: ShieldCheck,
  },
  {
    id: 'account',
    label: 'Account',
    description: 'Connected apps and signing out',
    icon: KeyRound,
  },
] as const;

/** What the bare `/account/settings` URL shows once there is room for a rail. */
export const DEFAULT_SECTION_ID: SettingsSectionId = 'profile';

export const SETTINGS_PATH = '/account/settings';

/** The canonical, shareable URL for one section. */
export function sectionHref(id: SettingsSectionId): string {
  return `${SETTINGS_PATH}?section=${id}`;
}

export function findSection(id: SettingsSectionId): SettingsSection {
  // A non-null assertion would be shorter and would lie: the fallback is what
  // keeps this total if an id is ever added to the union and not to the list.
  return SETTINGS_SECTIONS.find((section) => section.id === id) ?? SETTINGS_SECTIONS[0];
}

/**
 * One `?section=` value → a section, or `null` for "nothing was chosen".
 *
 * An UNRECOGNISED value is treated as ABSENT, never as an error. These URLs get
 * shared and hand-edited, the page is already scoped to the person asking, and
 * a settings screen that renders a 404 because somebody mistyped a query string
 * is worse than one that opens on its default. Exactly the rule the organizer
 * lists and the browse page's date params follow.
 *
 * Trimmed and lower-cased for the same reason: `?section=Appearance` from a
 * hand-typed link means Appearance, and dropping it would look like the link
 * was broken.
 */
export function parseSectionId(raw: string | null | undefined): SettingsSectionId | null {
  if (!raw) return null;
  const normalised = raw.trim().toLowerCase();
  return SETTINGS_SECTIONS.find((section) => section.id === normalised)?.id ?? null;
}

/**
 * The whole URL → the open section.
 *
 * `calendar` WINS over `section`, and that is the point of this function.
 * `GoogleCalendarConnectCallbackView` redirects to a fixed
 * `/account/settings?calendar=connected` (or `?calendar=error&reason=…`), and
 * that outcome banner is rendered by the card inside the Account section. Left
 * to `section` alone, a person returning from Google's consent screen would
 * land on Profile and never see whether the thing they just authorised
 * actually connected — which is the one moment the sentence matters. The
 * combination is only reachable by hand-editing, since the callback never adds
 * `section` itself.
 */
export function resolveSection(params: {
  section?: string | null;
  calendar?: string | null;
}): SettingsSectionId | null {
  if (params.calendar) return 'account';
  return parseSectionId(params.section);
}

/**
 * The section the CONTENT column renders — always one, never none.
 *
 * The pair `resolveSection` / `contentSectionFor` is what lets ONE url be two
 * layouts with no viewport measuring and nothing to hydrate: a bare
 * `/account/settings` is an INDEX of section cards on a phone (`resolveSection`
 * → `null`, so the index renders and the content column is `hidden`) and a rail
 * plus its default section from `lg` up (`contentSectionFor` → `profile`), decided
 * by a media query alone. Separating them is the whole reason `resolveSection`
 * is allowed to answer "nothing was chosen" instead of quietly defaulting.
 */
export function contentSectionFor(params: {
  section?: string | null;
  calendar?: string | null;
}): SettingsSectionId {
  return resolveSection(params) ?? DEFAULT_SECTION_ID;
}
