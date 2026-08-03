/** The search vocabulary, shared by the provider and the overlay UI. */

export type SuggestionType = 'event' | 'artist' | 'venue' | 'organizer' | 'city';

export type Suggestion = {
  /** Stable within a result set — used as the React key and the active-item id. */
  id: string;
  type: SuggestionType;
  label: string;
  sublabel?: string;
  /** Where selecting it goes. */
  href: string;
};

export type SuggestionGroup = {
  type: SuggestionType;
  label: string;
  items: Suggestion[];
};

/**
 * The seam. Today `derivedSuggestions` implements this on top of the existing
 * `GET /events?q=`; when the backend ships a real autocomplete endpoint the
 * only change is a different implementation of this ONE interface — no UI
 * component knows the difference. See BACKLOG.md item 1.
 */
export type SuggestionsProvider = (
  query: string,
  options?: { signal?: AbortSignal; limit?: number },
) => Promise<SuggestionGroup[]>;
