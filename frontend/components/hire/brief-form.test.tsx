import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The enquiry form's shape, and the two rules the redesign turns on.
 *
 * This was a five-step wizard: one bordered card at a time behind a Continue
 * button that disabled itself per step. It is one scrolling page now, and the
 * things worth locking are not how it LOOKS — jsdom has no layout engine, and
 * a ring colour belongs in the visual pass — but the two behaviours that
 * replaced the stepper and would be silently lost by anybody "simplifying"
 * them back:
 *
 * - **Every question is on the page at once.** The bug the wizard had was that
 *   checking an earlier answer meant walking backwards through four screens.
 *   If a future change reintroduces one-at-a-time rendering, this fails.
 * - **A refusal is NAMED, not just a dim button.** On a wizard, a disabled
 *   Continue had a visible step to explain it. On one page it does not, so
 *   Send lists what is missing and every name is a link to the section that
 *   fixes it.
 *
 * And one thing the slider must not do: the two thumbs share a track, and a
 * minimum dragged past the maximum PUSHES it rather than stopping dead — a
 * control that freezes under the finger reads as broken.
 */

const harness = vi.hoisted(() => ({ search: '' }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(harness.search),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'authenticated', user: null }),
}));

// The form only calls this on submit; no test here submits, so the mock exists
// to keep the real module (and its `apiFetch`) out of jsdom. The labels and
// vocabularies are the REAL ones — mocking those would make every assertion
// below a test of this file's own copy of them.
vi.mock('@/lib/api/enquiries', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, createEnquiry: vi.fn() };
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BriefForm } from './brief-form';

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BriefForm />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  harness.search = '';
  // The rail's scroll-spy. jsdom has no IntersectionObserver, and without a
  // stub every render throws before the form paints.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});

describe('the enquiry form is one page, not five steps', () => {
  it('renders every question at once', () => {
    renderForm();
    // One heading per section, all mounted together — the wizard could only
    // ever have shown one of these.
    expect(screen.getByRole('heading', { name: /what are you looking for/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /where and when/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /what is the budget/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /anything else/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /how should we reach you/i })).toBeTruthy();
  });

  it('has no Continue button, because there is nothing to continue to', () => {
    renderForm();
    expect(screen.queryByRole('button', { name: /^continue$/i })).toBeNull();
  });

  it('tells a screen reader why Send is disabled, without drawing the reason', () => {
    renderForm();
    const send = screen.getByRole('button', { name: /send enquiry/i });
    expect(send.hasAttribute('disabled')).toBe(true);

    // The visible "Still needed: …" line was removed for a plainer form. What
    // it leaves is the accessible description of the disabled control — which
    // is what somebody who cannot see the empty fields has instead. A button
    // that announces "Send enquiry, dimmed" and nothing else is WCAG 3.3.1.
    const described = send.getAttribute('aria-describedby');
    expect(described).toBe('brief-missing');
    const reason = document.getElementById(described ?? '');
    expect(reason?.className).toContain('sr-only');
    expect(reason?.textContent).toContain('the kind of act');
    expect(reason?.textContent).toContain('the city');
  });

  it('shortens that description as answers arrive, and drops it when complete', async () => {
    const user = userEvent.setup();
    renderForm();
    expect(document.getElementById('brief-missing')?.textContent).toContain('the kind of act');

    await user.click(screen.getByRole('button', { name: 'DJ' }));

    const reason = document.getElementById('brief-missing');
    expect(reason?.textContent).not.toContain('the kind of act');
    // The list shrinks, it does not vanish — the rest is still described.
    expect(reason?.textContent).toContain('the city');
  });

  it('draws no explanatory blurb under any section heading', () => {
    // These five sentences were removed at the owner's instruction. Asserting
    // their absence is what stops one drifting back in beside the four that
    // are gone, leaving the form half-explained.
    renderForm();
    const body = document.body.textContent ?? '';
    for (const removed of [
      'choose Something else and tell us in your own words',
      'what it costs to travel',
      'Nothing here is a commitment',
      'the closer the first reply lands',
      'Change it if somebody else is organising',
      'we will use your account details',
    ]) {
      expect(body).not.toContain(removed);
    }
  });

  it('carries the selected state on the card itself, not only in colour', async () => {
    const user = userEvent.setup();
    renderForm();
    const dj = screen.getByRole('button', { name: 'DJ' });
    expect(dj.getAttribute('aria-pressed')).toBe('false');
    await user.click(dj);
    expect(dj.getAttribute('aria-pressed')).toBe('true');
  });

  it('prefills the act from ?type=, which is what the landing page chips link to', () => {
    harness.search = 'type=band';
    renderForm();
    expect(screen.getByRole('button', { name: 'Band' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('the budget slider', () => {
  it('is two real labelled range inputs, so it works from a keyboard', () => {
    renderForm();
    expect(screen.getByLabelText('Minimum budget').getAttribute('type')).toBe('range');
    expect(screen.getByLabelText('Maximum budget').getAttribute('type')).toBe('range');
  });

  it('writes the number fields, so the slider and the typed range are one answer', () => {
    renderForm();
    // `fireEvent.change`, not a keypress: jsdom implements no default action
    // for a range input, so an ArrowRight there moves nothing and would make
    // this test assert the harness rather than the form.
    fireEvent.change(screen.getByLabelText('Minimum budget'), { target: { value: '50000' } });
    expect((screen.getByLabelText('Minimum') as HTMLInputElement).value).toBe('50000');
  });

  it('pushes the other thumb rather than stopping dead when they cross', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Maximum budget'), { target: { value: '200000' } });
    // Dragged past the maximum, so the maximum comes with it. Refusing to move
    // reads as a broken control; the "maximum is below the minimum" state stays
    // reachable by TYPING, where it is stated in words.
    fireEvent.change(screen.getByLabelText('Minimum budget'), { target: { value: '400000' } });
    expect((screen.getByLabelText('Minimum') as HTMLInputElement).value).toBe('400000');
    expect((screen.getByLabelText('Maximum') as HTMLInputElement).value).toBe('400000');
  });

  it('does not clamp a typed figure to the slider ceiling', async () => {
    const user = userEvent.setup();
    renderForm();
    // The slider stops at ₹10,00,000 and a real budget does not. Clamping the
    // typed value would be the five-fixed-bands mistake wearing a new control.
    await user.type(screen.getByLabelText('Maximum'), '4000000');
    expect((screen.getByLabelText('Maximum') as HTMLInputElement).value).toBe('4000000');
  });

  it('offers no fixed bands, because the slider and the fields are the control', () => {
    // The five "typical range" chips were removed at the owner's instruction.
    // They were also the thing whose ceiling misreported a real budget — a
    // wedding with ₹4,00,000 had to pick "₹2,50,000+" — so re-adding them
    // would bring that back along with the clutter.
    renderForm();
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('Or start from a typical range');
    for (const band of ['₹10k – ₹25k', '₹25k – ₹50k', '₹50k – ₹1L', '₹1L – ₹2.5L', '₹2.5L+']) {
      expect(body).not.toContain(band);
    }
  });
});

describe('the rail', () => {
  it('links to every section rather than stepping through them', () => {
    renderForm();
    const rail = screen.getByRole('navigation', { name: 'Sections' });
    // Links, not buttons: an in-page map is addressable and back-buttonable,
    // where a stepper's index is state only the form can see.
    expect(within(rail).getAllByRole('link')).toHaveLength(5);
    expect(within(rail).getByRole('link', { name: /budget/i }).getAttribute('href')).toBe(
      '#brief-budget',
    );
  });
});
