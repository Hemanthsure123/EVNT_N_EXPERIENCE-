import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * THE SCAN DESK — what it offers, in what order, and what it sends.
 *
 * The camera itself cannot run in jsdom, so `useCameraScanner` is replaced by
 * a harness the tests drive directly — including its `onDecode`, which is how
 * a real camera scan reaches `submit`. Everything asserted is a claim the desk
 * makes to a steward or to the API.
 */

const harness = vi.hoisted(() => ({
  camera: {
    state: 'idle' as string,
    supported: true,
    message: '',
    facing: 'environment' as 'environment' | 'user',
    canFlip: false,
    torchSupported: false,
    torchOn: false,
    start: vi.fn(),
    stop: vi.fn(),
    flip: vi.fn(),
    toggleTorch: vi.fn(),
  },
  onDecode: null as null | ((value: string) => void),
  params: '',
  rows: [
    { id: 'evt-1', title: 'Midnight Comedy' },
    { id: 'evt-2', title: 'Sunburn Jazz' },
  ],
  verify: vi.fn(),
}));

vi.mock('@/lib/organizer/scanner', () => ({
  useCameraScanner: ({ onDecode }: { onDecode: (value: string) => void }) => {
    harness.onDecode = onDecode;
    return { ...harness.camera, videoRef: { current: null } };
  },
  ScanSound: class {
    unlock() {}
    allowed() {}
    denied() {}
    close() {}
  },
}));

vi.mock('@/lib/organizer/queries', () => ({
  useEventRows: () => ({
    data: { pages: [{ data: harness.rows, meta: { next: null } }] },
    isPending: false,
  }),
}));

vi.mock('@/lib/api/organizer-writes', () => ({
  verifyTicket: (input: unknown) => harness.verify(input),
  fetchAttendance: () => Promise.resolve({ event_id: 'evt-1', admitted: 3, capacity: 10 }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(harness.params),
}));

import { ScanDesk } from './scan-desk';

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ScanDesk />
    </QueryClientProvider>,
  );
}

const ALLOWED = {
  allowed: true,
  reason: 'allowed',
  ticket_id: 't-1',
  event_id: 'evt-1',
  ticket_type: 'Gold',
  used_at: '2026-09-15T18:00:00Z',
  gate: '',
};

beforeEach(() => {
  harness.camera = {
    state: 'idle',
    supported: true,
    message: '',
    facing: 'environment',
    canFlip: false,
    torchSupported: false,
    torchOn: false,
    start: vi.fn(),
    stop: vi.fn(),
    flip: vi.fn(),
    toggleTorch: vi.fn(),
  };
  harness.params = '';
  harness.verify = vi.fn().mockResolvedValue(ALLOWED);
  try {
    window.localStorage.clear();
  } catch {
    // no storage in this environment — nothing to clear
  }
});

describe('the layout is camera first', () => {
  it('puts the scanner above the results', () => {
    mount();
    const open = screen.getByRole('button', { name: /Tap to open scanner/ });
    const recent = screen.getByRole('heading', { name: 'Recent scans' });
    // DOCUMENT_POSITION_FOLLOWING: the results come AFTER the scanner.
    expect(open.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has no Gate field', () => {
    mount();
    expect(screen.queryByLabelText(/gate/i)).toBeNull();
    expect(screen.queryByText(/^Gate$/)).toBeNull();
  });

  it('opens the camera from the one pulsing button, and not by itself', () => {
    mount();
    expect(harness.camera.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Tap to open scanner/ }));
    expect(harness.camera.start).toHaveBeenCalledTimes(1);
  });
});

describe('manual entry', () => {
  it('is collapsed until asked for', () => {
    mount();
    const toggle = screen.getByRole('button', { name: /Enter code manually/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: /Hide manual entry/ }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('verifies against the selected event, and sends no gate', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Enter code manually/ }));
    fireEvent.change(screen.getByLabelText('Ticket code'), { target: { value: 'v1.abc.def' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(harness.verify).toHaveBeenCalled());
    // EXACT: the absence of a `gate` key is the point.
    expect(harness.verify).toHaveBeenCalledWith({ event_id: 'evt-1', qr_token: 'v1.abc.def' });
    expect(await screen.findByText('Let them in')).toBeTruthy();
  });

  it('opens by itself where no camera can', () => {
    harness.camera.supported = false;
    mount();
    expect(screen.getByText('No camera here')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Hide manual entry/ }).getAttribute('aria-expanded'),
    ).toBe('true');
  });
});

describe('the verdict', () => {
  it('a camera decode reaches the same verify call', async () => {
    mount();
    harness.onDecode?.('v1.from.camera');
    await waitFor(() =>
      expect(harness.verify).toHaveBeenCalledWith({ event_id: 'evt-1', qr_token: 'v1.from.camera' }),
    );
  });

  it('a denial names its reason in words', async () => {
    harness.verify = vi.fn().mockResolvedValue({
      ...ALLOWED,
      allowed: false,
      reason: 'denied_already_used',
    });
    mount();
    harness.onDecode?.('v1.used.ticket');
    expect(await screen.findByText('Do not admit')).toBeTruthy();
    expect(screen.getAllByText(/Already checked in/).length).toBeGreaterThan(0);
  });
});

describe('camera controls only where the hardware said yes', () => {
  it('draws no torch and no flip on a device without them', () => {
    harness.camera.state = 'running';
    mount();
    expect(screen.getByRole('button', { name: 'Close the camera' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /flashlight/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Switch camera' })).toBeNull();
  });

  it('draws both when they exist', () => {
    harness.camera.state = 'running';
    harness.camera.torchSupported = true;
    harness.camera.canFlip = true;
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Turn the flashlight on' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch camera' }));
    expect(harness.camera.toggleTorch).toHaveBeenCalled();
    expect(harness.camera.flip).toHaveBeenCalled();
  });
});

describe('the deep link is verified, not trusted', () => {
  it('honours an event it can scan for', () => {
    harness.params = 'event=evt-2';
    mount();
    expect((screen.getByRole('combobox', { name: 'Event' }) as HTMLSelectElement).value).toBe(
      'evt-2',
    );
  });

  it('says so when it cannot', () => {
    // A desk silently stationed at the wrong event denies a whole queue of
    // valid tickets with `denied_wrong_event`.
    harness.params = 'event=not-live';
    mount();
    expect(screen.getByRole('alert').textContent).toMatch(/not on sale/);
  });
});
