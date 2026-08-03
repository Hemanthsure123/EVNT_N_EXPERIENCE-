import { describe, expect, it } from 'vitest';
import { toCsv, type ColumnDef } from './table';

/**
 * The CSV export.
 *
 * The formula-injection guard is the reason this file exists. Customer names
 * and refund reasons are user-supplied and go straight into a file somebody
 * opens in Excel, so a value beginning `=` is a real path out of our data into
 * someone else's spreadsheet.
 */

type Row = { name: string; amount: number };

const COLUMNS: ColumnDef<Row>[] = [
  { key: 'name', header: 'Name', width: 100, sortValue: (row) => row.name, render: () => null },
  {
    key: 'amount',
    header: 'Amount',
    width: 100,
    sortValue: (row) => row.amount,
    exportValue: (row) => row.amount / 100,
    render: () => null,
  },
];

describe('toCsv', () => {
  it('writes a header from the columns actually on screen', () => {
    expect(toCsv(COLUMNS, []).split('\r\n')[0]).toBe('Name,Amount');
  });

  it('prefers exportValue over sortValue', () => {
    // Money is minor units everywhere in this API; the export is major, so a
    // spreadsheet summing the column is not out by a factor of a hundred.
    expect(toCsv(COLUMNS, [{ name: 'Asha', amount: 49_900 }])).toContain('Asha,499');
  });

  it('quotes a value containing a comma', () => {
    expect(toCsv(COLUMNS, [{ name: 'Rao, Asha', amount: 0 }])).toContain('"Rao, Asha"');
  });

  it('doubles an embedded quote, per RFC 4180', () => {
    expect(toCsv(COLUMNS, [{ name: 'The "Big" One', amount: 0 }])).toContain('"The ""Big"" One"');
  });

  it('quotes a value containing a newline rather than breaking the row', () => {
    const csv = toCsv(COLUMNS, [{ name: 'Line one\nLine two', amount: 0 }]);
    expect(csv).toContain('"Line one\nLine two"');
    // Header plus ONE record — the embedded newline must not split the row.
    expect(csv.split('\r\n')).toHaveLength(2);
  });

  it.each(['=1+1', '+1', '-1', '@SUM(A1)'])(
    'neutralises %s, which Excel would otherwise execute as a formula',
    (hostile) => {
      const csv = toCsv(COLUMNS, [{ name: hostile, amount: 0 }]);
      expect(csv).toContain(`'${hostile}`);
    },
  );

  it('separates records with CRLF, which is what Excel on Windows expects', () => {
    const csv = toCsv(COLUMNS, [
      { name: 'One', amount: 100 },
      { name: 'Two', amount: 200 },
    ]);
    expect(csv.split('\r\n')).toHaveLength(3);
  });

  it('writes an empty cell for a column with no export or sort value', () => {
    const columns: ColumnDef<Row>[] = [
      { key: 'name', header: 'Name', width: 100, render: () => null },
    ];
    expect(toCsv(columns, [{ name: 'Asha', amount: 0 }])).toBe('Name\r\n');
  });
});
