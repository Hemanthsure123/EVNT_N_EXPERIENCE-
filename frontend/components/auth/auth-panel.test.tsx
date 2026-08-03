import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthPanel } from './auth-panel';
import { ProviderNotConfiguredError } from '@/lib/api/auth';
// Type-only, so it is erased before the hoisted `vi.mock` factory below runs.
import type * as AuthApi from '@/lib/api/auth';

/**
 * The sign-in panel's three load-bearing promises, which are all about what it
 * REFUSES to do rather than what it renders.
 *
 * Everything downstream of this component — a ticket, a payment, a refund — is
 * attributed to whoever it claims you are, so the failure modes worth a test
 * are "a control that looks like it works and doesn't" and "a control for a
 * provider nobody wired". Layout is not tested here; it changes on purpose.
 */

const mocks = vi.hoisted(() => ({
  googleSignInAvailable: vi.fn(),
  requestPhoneOtp: vi.fn(),
  startOAuth: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock('@/lib/api/auth', async (importOriginal) => {
  // `importOriginal` keeps the REAL `ProviderNotConfiguredError`: the panel
  // branches on `instanceof`, so a stubbed class would make the honest-failure
  // path untestable by construction.
  const actual = await importOriginal<typeof AuthApi>();
  return {
    ...actual,
    googleSignInAvailable: mocks.googleSignInAvailable,
    requestPhoneOtp: mocks.requestPhoneOtp,
    verifyPhoneOtp: vi.fn(),
    resendVerification: vi.fn(),
    startOAuth: mocks.startOAuth,
  };
});

vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({
    status: 'anonymous',
    user: null,
    signIn: mocks.signIn,
    signUp: mocks.signUp,
    signOut: vi.fn(),
    verifyEmail: vi.fn(),
    resendVerification: vi.fn(),
  }),
}));

const SUBHEADING = 'Sign in to see your tickets and pick up where you left off.';

const panel = () =>
  render(
    <AuthPanel onAuthenticated={vi.fn()} heading="Welcome back" subheading={SUBHEADING} />,
  );

describe('AuthPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.googleSignInAvailable.mockResolvedValue(false);
    mocks.requestPhoneOtp.mockRejectedValue(new ProviderNotConfiguredError('Phone'));
  });

  it('does not offer Apple at all', async () => {
    panel();
    await waitFor(() => expect(mocks.googleSignInAvailable).toHaveBeenCalled());

    // Not "hidden behind a flag" — absent. A provider with no backend and no
    // planned one is a control whose only behaviour is to report itself broken.
    expect(screen.queryByRole('button', { name: /apple/i })).toBeNull();
  });

  it('shows Google only once the backend confirms this deployment has it', async () => {
    panel();
    await waitFor(() => expect(mocks.googleSignInAvailable).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /continue with google/i })).toBeNull();

    // The credentials live only on the server, so the button cannot be inferred
    // from a NEXT_PUBLIC flag — and one that 503s is worse than no button.
    mocks.googleSignInAvailable.mockResolvedValue(true);
    panel();
    expect(await screen.findByRole('button', { name: /continue with google/i })).toBeVisible();
  });

  it('renders the primary action AFTER the fields, so a late Google button cannot displace it', async () => {
    mocks.googleSignInAvailable.mockResolvedValue(true);
    panel();

    const google = await screen.findByRole('button', { name: /continue with google/i });
    const submit = screen.getByRole('button', { name: 'Sign in' });

    // `compareDocumentPosition` rather than a snapshot: the assertion is the
    // ORDER, which is what stops the form jumping under a reaching cursor when
    // the config round trip lands.
    expect(submit.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('fails phone sign-in instantly, with a sentence naming the provider', async () => {
    panel();
    await waitFor(() => expect(mocks.googleSignInAvailable).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('tab', { name: 'Phone' }));
    await userEvent.type(screen.getByLabelText('Phone number'), '+919876543210');
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));

    // A status, not an alert: nothing went wrong and the user did nothing
    // wrong. And never a spinner, and never a code screen that no code reaches.
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/phone sign-in isn't connected yet/i);
    expect(screen.queryByLabelText('Verification code')).toBeNull();
  });

  it('moves the subheading with the mode, not just the heading', async () => {
    panel();
    await waitFor(() => expect(mocks.googleSignInAvailable).toHaveBeenCalled());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome back');
    expect(screen.getByText(SUBHEADING)).toBeVisible();

    await userEvent.click(screen.getByRole('tab', { name: 'Create account' }));

    // The caller's subheading is the SIGN-IN one. Leaving it in place under a
    // registration form was the old behaviour and read as a broken tab.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Create your account');
    expect(screen.queryByText(SUBHEADING)).toBeNull();
    expect(screen.getByLabelText('Full name')).toBeVisible();
  });
});
