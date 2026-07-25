import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Pagination } from './pagination';

describe('Pagination', () => {
  it('disables Previous at the start and calls onNext', async () => {
    const onNext = vi.fn();
    render(<Pagination hasPrevious={false} hasNext onNext={onNext} />);
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('disables Next at the end', () => {
    render(<Pagination hasPrevious hasNext={false} />);
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });
});
