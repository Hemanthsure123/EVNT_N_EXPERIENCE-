import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider, useTheme } from './theme-provider';

function Probe() {
  const { resolvedTheme, toggle } = useTheme();
  return (
    <button type="button" onClick={toggle}>
      theme:{resolvedTheme}
    </button>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('toggles the dark class on <html> and persists the choice', async () => {
    render(
      <ThemeProvider defaultTheme="light">
        <Probe />
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    await userEvent.click(screen.getByRole('button'));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(window.localStorage.getItem('ee-theme')).toBe('dark');
  });
});
