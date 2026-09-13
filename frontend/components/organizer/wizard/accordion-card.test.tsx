import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AccordionCard, Section } from './fields';

/**
 * The wizard's section card: a TOGGLE that opens a section, closed by default.
 *
 * Three properties are worth pinning, and none of them is how it looks.
 */
describe('AccordionCard', () => {
  it('starts closed and hides its fields', () => {
    // Every section on the step is shut on arrival — that is the whole point
    // of the change, and the thing somebody "simplifying" would undo first.
    render(
      <AccordionCard title="Tags">
        <input aria-label="Inside" />
      </AccordionCard>,
    );

    expect(screen.getByRole('button', { name: /Tags/ }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    // `hidden`, not merely styled away: a field a screen reader can still
    // reach inside a section the user has closed is a form with two states.
    expect(screen.getByLabelText('Inside').closest('[hidden]')).not.toBeNull();
  });

  it('opens and closes on the toggle', () => {
    render(
      <AccordionCard title="Tags">
        <input aria-label="Inside" />
      </AccordionCard>,
    );
    const toggle = screen.getByRole('button', { name: /Tags/ });

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('Inside').closest('[hidden]')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('announces expanded/collapsed rather than on/off', () => {
    // It is drawn as a switch and it is NOT `role="switch"`. A switch
    // announces "on/off", which is what a setting is — and this changes
    // nothing about the event, it reveals fields that were always going to be
    // saved. "Tags, switch, off" would reasonably be heard as "tags are
    // disabled"; `aria-expanded` says "collapsed", which is the truth.
    render(<AccordionCard title="Tags">body</AccordionCard>);
    const toggle = screen.getByRole('button', { name: /Tags/ });
    expect(toggle.getAttribute('role')).not.toBe('switch');
    expect(toggle.hasAttribute('aria-expanded')).toBe(true);
    // And it points at the region it controls, so the relationship survives
    // the visual one being lost.
    expect(toggle.getAttribute('aria-controls')).toBeTruthy();
  });

  it('says what a closed card holds', () => {
    // `count` is what makes collapsing safe: a shut card that carries a value
    // reports it, so the step reads as a summary rather than a row of doors.
    render(
      <AccordionCard title="Gallery photos" count="3 of 10">
        body
      </AccordionCard>,
    );
    expect(screen.getByText('3 of 10')).toBeTruthy();
  });

  it('marks a section with a problem, without forcing it open', () => {
    // "Closed by default" and "errors surface on save" would otherwise combine
    // into a form that refuses to submit and shows nothing anywhere.
    render(
      <AccordionCard title="Tickets" invalid>
        body
      </AccordionCard>,
    );
    expect(screen.getByLabelText('Needs attention')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Tickets/ }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('honours defaultOpen for the sections that earn it', () => {
    render(
      <AccordionCard title="Cover image" defaultOpen>
        body
      </AccordionCard>,
    );
    expect(screen.getByRole('button', { name: /Cover image/ }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('is the same component every call site already imports as Section', () => {
    // The alias is why "every section becomes a toggle" was one component
    // changing rather than twenty imports.
    expect(Section).toBe(AccordionCard);
  });
});
