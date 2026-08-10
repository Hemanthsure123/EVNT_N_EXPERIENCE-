import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StarRatingDisplay, StarRatingInput } from './star-rating';

/**
 * The rating control. What is worth testing is the keyboard and the hover
 * preview — the two places a star row is usually wrong in ways nobody sees
 * with a mouse and good eyesight.
 */

function Harness({ onChange }: { onChange: (n: number) => void }) {
  const [value, setValue] = React.useState(0);
  return (
    <StarRatingInput
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('StarRatingInput', () => {
  it('is one radio group with five options, not five buttons', () => {
    render(<StarRatingInput value={0} onChange={vi.fn()} />);
    expect(screen.getByRole('radiogroup', { name: /your rating/i })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
  });

  it('exposes exactly one tab stop, so a rating is one Tab away', () => {
    render(<StarRatingInput value={3} onChange={vi.fn()} />);
    const focusable = screen.getAllByRole('radio').filter((el) => el.tabIndex === 0);
    expect(focusable).toHaveLength(1);
    // The roving stop follows the selection.
    expect(focusable[0]).toHaveAttribute('aria-checked', 'true');
  });

  it('names each star so the scale is legible', () => {
    render(<StarRatingInput value={0} onChange={vi.fn()} />);
    // "3 of 5" says nothing about whether 3 is a complaint.
    expect(screen.getByRole('radio', { name: /Excellent — 5 out of 5/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Poor — 1 out of 5/ })).toBeInTheDocument();
  });

  it('moves with arrow keys and CLAMPS at both ends', async () => {
    // Wrapping would turn the best rating into the worst with one keypress.
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: /5 out of 5/ }));
    expect(onChange).toHaveBeenLastCalledWith(5);

    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith(5); // clamped, not wrapped to 1

    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith(4);
  });

  it('does not commit a rating just because the pointer passed over it', async () => {
    // The classic dark pattern in a star row.
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<StarRatingInput value={0} onChange={onChange} />);
    await user.hover(screen.getByRole('radio', { name: /4 out of 5/ }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('says nothing is chosen until something is', () => {
    render(<StarRatingInput value={0} onChange={vi.fn()} />);
    expect(screen.getByText('Tap a star to rate')).toBeInTheDocument();
    expect(screen.getAllByRole('radio').every((el) => el.getAttribute('aria-checked') === 'false')).toBe(
      true,
    );
  });
});

describe('StarRatingDisplay', () => {
  it('announces the value once rather than five decorative stars', () => {
    render(<StarRatingDisplay value={4} />);
    expect(screen.getByText('4 out of 5')).toBeInTheDocument();
    // Nothing interactive: this is a readout, not a control.
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
