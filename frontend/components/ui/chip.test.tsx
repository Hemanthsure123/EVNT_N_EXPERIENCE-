import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Chip } from './chip';

describe('Chip', () => {
  it('reflects its selected state via aria-pressed', () => {
    const { rerender } = render(<Chip selected={false}>Music</Chip>);
    expect(screen.getByRole('button', { name: 'Music' })).toHaveAttribute('aria-pressed', 'false');
    rerender(<Chip selected>Music</Chip>);
    expect(screen.getByRole('button', { name: 'Music' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('fires onClick when toggled', async () => {
    const onClick = vi.fn();
    render(<Chip onClick={onClick}>Comedy</Chip>);
    await userEvent.click(screen.getByRole('button', { name: 'Comedy' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
