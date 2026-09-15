import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EventsFilterBar, sheetFilterCount, type EventFilterValues } from './events-filter-bar';

/**
 * MY EVENTS — the one filter row and the sheet behind it.
 */

const EMPTY: EventFilterValues = { q: '', status: '', city: '', preset: '', from: '', to: '' };

function mount(values: Partial<EventFilterValues> = {}) {
  const onChange = vi.fn();
  render(
    <EventsFilterBar values={{ ...EMPTY, ...values }} onChange={onChange} cityOptions={['Pune']} />,
  );
  return onChange;
}

describe('the Filters badge counts only what the row cannot show', () => {
  it('does not double-count a lifecycle status', () => {
    // "Live" is already the lit pill. Counting it on Filters too would say two
    // filters are applied when one is.
    expect(sheetFilterCount({ ...EMPTY, status: 'live' })).toBe(0);
  });

  it('counts a status the pills cannot show', () => {
    expect(sheetFilterCount({ ...EMPTY, status: 'cancelled' })).toBe(1);
  });

  it('counts a city and a date as one each', () => {
    expect(sheetFilterCount({ ...EMPTY, city: 'Pune', preset: '7' })).toBe(2);
    expect(sheetFilterCount({ ...EMPTY, from: '2026-09-01T00:00:00.000Z' })).toBe(1);
  });
});

describe('the row', () => {
  it('carries search, Filters and the four lifecycle pills', () => {
    mount();
    expect(screen.getByRole('searchbox', { name: 'Search your events' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
    for (const label of ['All', 'Live', 'Past', 'Drafts']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('writes the status straight from a pill', () => {
    const onChange = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Live' }));
    expect(onChange).toHaveBeenCalledWith({ status: 'live' });
  });

  it('says how many sheet filters are on', () => {
    mount({ city: 'Pune' });
    expect(screen.getByRole('button', { name: 'Filters, 1 applied' })).toBeTruthy();
  });
});

describe('the sheet', () => {
  it('opens as a dialog instead of expanding inline', () => {
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByRole('dialog', { name: 'Filter events' })).toBeTruthy();
  });

  it('applies a draft in one go, and only on Apply', () => {
    const onChange = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const sheet = screen.getByRole('dialog', { name: 'Filter events' });

    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancelled' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Last 7 days' }));
    // Draft-then-apply: nothing has been written yet.
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Apply' }));
    expect(onChange).toHaveBeenCalledWith({
      status: 'cancelled',
      city: '',
      preset: '7',
      from: '',
      to: '',
    });
  });

  it('never touches the search from inside the sheet', () => {
    // Search lives on the row. Clearing a query you cannot see from here is a
    // trap — so the sheet's payload does not carry `q` at all.
    const onChange = mount({ q: 'jazz', city: 'Pune' });
    fireEvent.click(screen.getByRole('button', { name: 'Filters, 1 applied' }));
    const sheet = screen.getByRole('dialog', { name: 'Filter events' });
    fireEvent.click(within(sheet).getByRole('button', { name: /Clear all/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Apply' }));
    const payload = onChange.mock.calls[0][0] as Record<string, string>;
    expect(payload).not.toHaveProperty('q');
    expect(payload.city).toBe('');
  });
});

describe('what the screen no longer has', () => {
  it('has no Columns, no Export and no inline filter cluster', () => {
    // Removed at the owner's instruction. A source scan, because an absent
    // control has no rendered output to assert against.
    const source = readFileSync(join(process.cwd(), 'components/organizer/events-table.tsx'), 'utf8');
    expect(source).not.toContain('<ColumnChooser');
    expect(source).not.toContain('<ExportButton');
    expect(source).not.toContain('<FilterCluster');
    expect(source).toContain('<EventsFilterBar');
  });
});
