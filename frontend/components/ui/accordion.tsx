'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * Accordion — a small, accessible disclosure group.
 *
 * ── WHY THIS IS HAND-BUILT ───────────────────────────────────────────────
 *
 * `@radix-ui/react-accordion` is NOT a dependency of this app and adding one is
 * out of scope, so this implements the WAI-ARIA accordion pattern directly. The
 * parts that are genuinely hard about a disclosure widget are the ones done
 * here rather than approximated: the trigger is a real `<button>` (so Enter and
 * Space come free and correct), each panel is a labelled `region` wired to its
 * trigger by id, arrow keys move between triggers, and a collapsed panel leaves
 * BOTH the tab order and the accessibility tree.
 *
 * ── THE COLLAPSED PANEL HAS TO ACTUALLY BE GONE ──────────────────────────
 *
 * A zero-height panel is still focusable and still read aloud. Tabbing into a
 * link inside a shut panel — and landing somewhere invisible — is the classic
 * hand-rolled-accordion bug. `visibility: hidden` removes it from both, and it
 * is the one property that can do that AND be transitioned: CSS holds
 * `visible` for the whole duration and flips at the end, so the panel is still
 * drawn while it collapses and is genuinely gone once it has.
 *
 * ── THE HEIGHT ANIMATION MEASURES NOTHING ────────────────────────────────
 *
 * `grid-template-rows: 0fr -> 1fr` animates to the content's natural height
 * with no `scrollHeight` read, no `ResizeObserver` and no re-measure when the
 * content reflows — which is what makes it correct for a panel whose contents
 * can change while it is open. The inner `overflow-hidden` is load-bearing:
 * without it a grid item's automatic minimum size refuses to collapse to zero
 * and the panel simply never closes.
 */

export type AccordionType = 'single' | 'multiple';

/**
 * The open/close decision, as a pure function — the whole of the component's
 * real logic, testable without rendering anything.
 *
 * `single` closes whatever else was open; `collapsible` decides whether the
 * open one may be closed by pressing it again. Returning the SAME array
 * contents for a no-op keeps a controlled caller from re-rendering over
 * nothing.
 */
export function toggleAccordionValue(
  open: readonly string[],
  value: string,
  options: { type: AccordionType; collapsible: boolean },
): string[] {
  const isOpen = open.includes(value);

  if (options.type === 'multiple') {
    return isOpen ? open.filter((entry) => entry !== value) : [...open, value];
  }

  if (!isOpen) return [value];
  return options.collapsible ? [] : [...open];
}

/** Accept a bare string for the common single-value case. */
function toArray(value: string | readonly string[] | null | undefined): string[] {
  if (value == null) return [];
  return typeof value === 'string' ? [value] : [...value];
}

type AccordionContextValue = {
  openValues: readonly string[];
  toggle: (value: string) => void;
  rootRef: React.RefObject<HTMLDivElement>;
};

const AccordionContext = React.createContext<AccordionContextValue | null>(null);

type AccordionItemContextValue = {
  value: string;
  open: boolean;
  disabled: boolean;
  triggerId: string;
  panelId: string;
};

const AccordionItemContext = React.createContext<AccordionItemContextValue | null>(null);

function useAccordion(part: string): AccordionContextValue {
  const context = React.useContext(AccordionContext);
  if (!context) throw new Error(`<${part}> must be rendered inside <Accordion>.`);
  return context;
}

function useAccordionItem(part: string): AccordionItemContextValue {
  const context = React.useContext(AccordionItemContext);
  if (!context) throw new Error(`<${part}> must be rendered inside <AccordionItem>.`);
  return context;
}

export interface AccordionProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'defaultValue' | 'onChange'> {
  /** `single` keeps at most one panel open; `multiple` allows any number. */
  type?: AccordionType;
  /** Controlled. A bare string is accepted for the single-value case. */
  value?: string | readonly string[] | null;
  /** Uncontrolled starting state. */
  defaultValue?: string | readonly string[] | null;
  /**
   * Always an ARRAY, in both modes. One callback shape means switching `type`
   * does not force the caller to rewrite its state handling.
   */
  onValueChange?: (open: string[]) => void;
  /**
   * Whether the open panel in `single` mode can be closed by pressing it
   * again. Defaults to true: a disclosure a reader cannot shut is a strange
   * affordance, and the case for `false` — the accordion IS the page's whole
   * content, so something must always be showing — is the rarer one and worth
   * asking for by name.
   */
  collapsible?: boolean;
}

export function Accordion({
  type = 'single',
  value,
  defaultValue,
  onValueChange,
  collapsible = true,
  className,
  children,
  ...props
}: AccordionProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [uncontrolled, setUncontrolled] = React.useState<string[]>(() => toArray(defaultValue));

  const controlled = value !== undefined;
  // Recomputed per render rather than memoised: a controlled caller may hand a
  // fresh array literal every time, so memoising on identity would be a cache
  // that never hits while pretending to.
  const openValues = controlled ? toArray(value) : uncontrolled;

  const toggle = React.useCallback(
    (itemValue: string) => {
      const next = toggleAccordionValue(controlled ? toArray(value) : uncontrolled, itemValue, {
        type,
        collapsible,
      });
      if (!controlled) setUncontrolled(next);
      onValueChange?.(next);
    },
    [collapsible, controlled, onValueChange, type, uncontrolled, value],
  );

  // Deliberately not memoised. `openValues` is a fresh array every render (a
  // controlled caller may hand one straight from props), so a memo keyed on it
  // would be a cache that never hits while pretending to — and the children
  // re-render with this component regardless.
  const context: AccordionContextValue = { openValues, toggle, rootRef };

  return (
    <AccordionContext.Provider value={context}>
      <div ref={rootRef} data-accordion-root="" className={cn('w-full', className)} {...props}>
        {children}
      </div>
    </AccordionContext.Provider>
  );
}

export interface AccordionItemProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Stable identity for this panel. */
  value: string;
  disabled?: boolean;
}

export function AccordionItem({
  value,
  disabled = false,
  className,
  children,
  ...props
}: AccordionItemProps) {
  const { openValues } = useAccordion('AccordionItem');
  const id = React.useId();

  const context: AccordionItemContextValue = {
    value,
    open: openValues.includes(value),
    disabled,
    // `useId`, not the item's own `value`: two accordions on one screen can
    // legitimately share a value ("details"), and duplicate ids would point
    // every `aria-controls` at whichever panel the browser found first.
    triggerId: `${id}-trigger`,
    panelId: `${id}-panel`,
  };

  return (
    <AccordionItemContext.Provider value={context}>
      <div
        data-state={context.open ? 'open' : 'closed'}
        className={cn('border-b border-border', className)}
        {...props}
      >
        {children}
      </div>
    </AccordionItemContext.Provider>
  );
}

export interface AccordionTriggerProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /**
   * The heading this trigger sits in. The pattern wraps every trigger in a
   * heading so the accordion appears in a screen reader's heading list, and the
   * LEVEL has to be the caller's call — a trigger inside a sheet whose title is
   * already an `h2` needs `3`, or the outline claims the two are peers.
   */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
}

export function AccordionTrigger({
  headingLevel = 3,
  className,
  children,
  onClick,
  onKeyDown,
  ...props
}: AccordionTriggerProps) {
  const { toggle, rootRef } = useAccordion('AccordionTrigger');
  const { value, open, disabled, triggerId, panelId } = useAccordionItem('AccordionTrigger');
  const Heading = `h${headingLevel}` as const;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    // Enter and Space are the button element's own; these four are what the
    // WAI-ARIA accordion pattern adds on top, and a group of disclosures
    // without them makes a reader tab through every panel's contents to reach
    // the next heading.
    const root = rootRef.current;
    if (!root) return;

    const triggers = Array.from(
      root.querySelectorAll<HTMLButtonElement>('[data-accordion-trigger]:not([disabled])'),
      // A nested accordion inside an open panel would otherwise join its
      // parent's arrow-key ring, so arrows would jump between two widgets.
    ).filter((trigger) => trigger.closest('[data-accordion-root]') === root);

    const index = triggers.indexOf(event.currentTarget);
    if (index < 0 || triggers.length === 0) return;

    let next: number;
    switch (event.key) {
      case 'ArrowDown':
        next = (index + 1) % triggers.length;
        break;
      case 'ArrowUp':
        next = (index - 1 + triggers.length) % triggers.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = triggers.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    triggers[next]?.focus();
  };

  return (
    <Heading className="flex">
      <button
        {...props}
        type="button"
        id={triggerId}
        aria-expanded={open}
        aria-controls={panelId}
        disabled={disabled}
        data-accordion-trigger=""
        data-state={open ? 'open' : 'closed'}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) toggle(value);
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex min-h-control w-full items-center gap-3 py-stack text-left text-body-sm font-semibold text-foreground',
          'transition-colors duration-fast ease-out hover:text-muted-foreground motion-reduce:transition-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:pointer-events-none disabled:opacity-60',
          className,
        )}
      >
        <span className="min-w-0 flex-1">{children}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-fast ease-out motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </button>
    </Heading>
  );
}

export function AccordionContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const { open, triggerId, panelId } = useAccordionItem('AccordionContent');

  return (
    <div
      // Spread FIRST: an `id` from the caller would otherwise win and detach
      // this panel from the `aria-controls` / `aria-labelledby` pair.
      {...props}
      id={panelId}
      role="region"
      aria-labelledby={triggerId}
      data-state={open ? 'open' : 'closed'}
      className={cn(
        'grid transition-[grid-template-rows,visibility] duration-base ease-out motion-reduce:transition-none',
        open ? 'visible grid-rows-[1fr]' : 'invisible grid-rows-[0fr]',
      )}
    >
      {/* Both classes are required, not defensive: `overflow-hidden` is what
          lets a grid item shrink below its content, and without it the panel
          animates to a smaller track while its contents spill out below. */}
      <div className="min-h-0 overflow-hidden">
        <div className={cn('pb-card text-body-sm text-muted-foreground', className)}>
          {children}
        </div>
      </div>
    </div>
  );
}
