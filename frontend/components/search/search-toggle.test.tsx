import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchProvider, useSearchOverlay } from './search-context';

/**
 * Pressing the search bar twice must CLOSE it.
 *
 * The bug this pins down: `openSearch` unconditionally set open=true, so a
 * second press on an already-open trigger ran two handlers in order — Radix's
 * dismiss-on-outside-pointerdown closed the panel, then the button's own click
 * reopened it. What a person saw was the panel blinking shut and immediately
 * back, which reads as the control being broken rather than as a toggle.
 *
 * It is tested at the CONTEXT level because that is where the decision lives,
 * and because reproducing the original failure needs both halves: the overlay's
 * dismissal (simulated here as a close arriving before the click) and the
 * trigger's press. A test that only pressed the button would have passed
 * against the buggy code.
 */

/**
 * Stand-in for the real overlay, reproducing the ORDERING that caused the bug.
 *
 * Measured in a real browser: `pointerdown` capture -> `pointerdown` bubble ->
 * `click`. Radix dismisses in the bubble phase, so a trigger that acts on
 * `click` always reads state Radix has already changed. The harness dismisses
 * on bubble-phase pointerdown, exactly as Radix does, WITHOUT any guard — so a
 * trigger that only works because a guard suppressed the dismissal fails here.
 */
function Harness() {
  const { open, anchor, triggerProps, closeSearch } = useSearchOverlay();
  const ref = React.useRef<HTMLButtonElement>(null);
  const press = triggerProps(() => ref.current);

  return (
    <div>
      <button
        ref={ref}
        type="button"
        onPointerDownCapture={press.onPointerDownCapture}
        // Radix's dismissal, unguarded and in the bubble phase.
        onPointerDown={() => {
          if (open) closeSearch();
        }}
        onClick={press.onClick}
      >
        Search events
      </button>
      <span data-testid="state">{open ? 'open' : 'closed'}</span>
      <span data-testid="anchored">{anchor ? 'anchored' : 'centred'}</span>
    </div>
  );
}

function OtherTrigger() {
  const { triggerProps } = useSearchOverlay();
  const ref = React.useRef<HTMLButtonElement>(null);
  const press = triggerProps(() => ref.current);
  return (
    <button
      ref={ref}
      type="button"
      onPointerDownCapture={press.onPointerDownCapture}
      onClick={press.onClick}
    >
      Other search
    </button>
  );
}

describe('search toggle', () => {
  it('opens on the first press', async () => {
    const user = userEvent.setup();
    render(
      <SearchProvider>
        <Harness />
      </SearchProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Search events' }));

    expect(screen.getByTestId('state')).toHaveTextContent('open');
    expect(screen.getByTestId('anchored')).toHaveTextContent('anchored');
  });

  it('closes on the second press even though the dismissal is unguarded', async () => {
    // The harness dismisses on bubble-phase pointerdown with NO suppression —
    // exactly what Radix does. The trigger still ends up closed, because it
    // decided in the CAPTURE phase and marked the press handled. That is what
    // makes the fix robust rather than lucky: it does not depend on beating
    // another library's listener, only on running before it.
    const user = userEvent.setup();
    render(
      <SearchProvider>
        <Harness />
      </SearchProvider>,
    );
    const trigger = screen.getByRole('button', { name: 'Search events' });

    await user.click(trigger);
    expect(screen.getByTestId('state')).toHaveTextContent('open');

    // Second press: capture decides, then the unguarded dismissal closes an
    // already-closed panel (a no-op), then click sees the press was handled.
    // Against the click-only trigger this ended OPEN.
    await user.click(trigger);
    expect(screen.getByTestId('state')).toHaveTextContent('closed');
  });

  it('moves the panel rather than closing it when a different trigger is pressed', async () => {
    // Toggling on `open` alone would have dismissed here, which is wrong: a
    // person pressing a second search control wants the panel there, not gone.
    const user = userEvent.setup();
    render(
      <SearchProvider>
        <Harness />
        <OtherTrigger />
      </SearchProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Search events' }));
    expect(screen.getByTestId('state')).toHaveTextContent('open');

    await user.click(screen.getByRole('button', { name: 'Other search' }));
    expect(screen.getByTestId('state')).toHaveTextContent('open');
  });

  it('opens centred with no anchor, and that toggles too', async () => {
    // The compact icon trigger passes `() => null`. `null` is a stable
    // identity, so the same-anchor comparison still works and a second press
    // closes.
    const user = userEvent.setup();
    function Compact() {
      const { open, triggerProps, closeSearch } = useSearchOverlay();
      const press = triggerProps(() => null);
      return (
        <>
          <button
            type="button"
            onPointerDownCapture={press.onPointerDownCapture}
            onPointerDown={() => {
              if (open) closeSearch();
            }}
            onClick={press.onClick}
          >
            Icon search
          </button>
          <span data-testid="state">{open ? 'open' : 'closed'}</span>
        </>
      );
    }
    render(
      <SearchProvider>
        <Compact />
      </SearchProvider>,
    );
    const trigger = screen.getByRole('button', { name: 'Icon search' });

    await user.click(trigger);
    expect(screen.getByTestId('state')).toHaveTextContent('open');

    await user.click(trigger);
    expect(screen.getByTestId('state')).toHaveTextContent('closed');
  });

  it('shares the operator terms with everything that asks', () => {
    // One list for the header bar's rolling hint and the panel's suggestions.
    // They used to be two reads, so on a cold open the bar showed the
    // operator's terms while the panel still showed the bundled defaults.
    function Terms() {
      const { terms } = useSearchOverlay();
      return <span data-testid="terms">{terms.map((t) => t.label).join('|')}</span>;
    }
    render(
      <SearchProvider terms={[{ label: 'Sunburn', href: '/events?q=sunburn' }]}>
        <Terms />
      </SearchProvider>,
    );

    expect(screen.getByTestId('terms')).toHaveTextContent('Sunburn');
  });

  it('falls back to the bundled list when the CMS sent none', () => {
    function Terms() {
      const { terms } = useSearchOverlay();
      return <span data-testid="count">{terms.length}</span>;
    }
    render(
      <SearchProvider terms={[]}>
        <Terms />
      </SearchProvider>,
    );

    expect(Number(screen.getByTestId('count').textContent)).toBeGreaterThan(0);
  });
});
