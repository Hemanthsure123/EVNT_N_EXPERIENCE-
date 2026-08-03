'use client';

import * as React from 'react';
import {
  fetchMe,
  login as loginRequest,
  logout as logoutRequest,
  redeemGoogleSignIn,
  register,
  resendVerification as resendVerificationRequest,
  verifyEmail as verifyEmailRequest,
} from '@/lib/api/auth';
import { tokenStore } from '@/lib/api/token-store';
import type { User } from '@/lib/api/types';

/**
 * Who is signed in, for the whole app.
 *
 * THREE states, not a boolean. The server cannot know — tokens live in
 * `localStorage` — so the first render on both sides is `unknown`, and anything
 * that depends on the answer renders nothing until it resolves. A boolean would
 * have to guess "anonymous" on the server, and an authenticated visitor would
 * watch a signed-out UI flash and disappear.
 *
 * A stored token is treated as a CLAIM, not proof: on mount the provider calls
 * `/auth/me` to confirm it. An expired token that still sits in storage would
 * otherwise show someone a signed-in checkout that fails at the first real
 * request — which, on this flow, is the moment they try to pay.
 *
 * The `storage` event keeps tabs in sync: signing out in one updates the others.
 */

export type AuthStatus = 'unknown' | 'anonymous' | 'authenticated';

type AuthValue = {
  status: AuthStatus;
  user: User | null;
  /** Staff, per `/auth/me`. False while auth is still resolving. */
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<User>;
  /**
   * Create an account. Does NOT sign in — the backend issues no session until
   * the address is proven, so this resolves to the pending user and the caller
   * must route to the verify step.
   */
  signUp: (email: string, password: string, fullName: string) => Promise<User>;
  /** Prove the address with the emailed code. THIS is what signs you in. */
  verifyEmail: (email: string, code: string) => Promise<User>;
  /** Ask for a fresh code. */
  resendVerification: (email: string) => Promise<void>;
  /** Adopt a session minted by the Google callback's one-time handoff. */
  completeGoogleSignIn: (handoff: string) => Promise<User>;
  signOut: () => Promise<void>;
};

const AuthContext = React.createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<AuthStatus>('unknown');
  const [user, setUser] = React.useState<User | null>(null);

  const resolve = React.useCallback(async () => {
    if (!tokenStore.getAccess()) {
      setUser(null);
      setStatus('anonymous');
      return;
    }
    try {
      setUser(await fetchMe());
      setStatus('authenticated');
    } catch {
      // The token is stale or revoked. Clearing it here is what stops a dead
      // session from following someone all the way to the payment step.
      tokenStore.clear();
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  React.useEffect(() => {
    void resolve();
    const onStorage = () => void resolve();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [resolve]);

  const value = React.useMemo<AuthValue>(
    () => ({
      status,
      user,
      isAdmin: status === 'authenticated' && Boolean(user?.is_staff),
      signIn: async (email, password) => {
        const { user: signedIn } = await loginRequest(email, password);
        setUser(signedIn);
        setStatus('authenticated');
        return signedIn;
      },
      signUp: async (email, password, fullName) => {
        const { user: created } = await register(email, password, fullName);
        // Deliberately NOT `setStatus('authenticated')`.
        //
        // Registration returns no tokens — verifying the address is what mints
        // the session. Marking the user authenticated here would leave the app
        // believing it had a session it does not have, and every subsequent
        // request would 401 with no obvious cause.
        return created;
      },
      verifyEmail: async (email, code) => {
        const { user: verified } = await verifyEmailRequest(email, code);
        setUser(verified);
        setStatus('authenticated');
        return verified;
      },
      resendVerification: async (email) => {
        await resendVerificationRequest(email);
      },
      completeGoogleSignIn: async (handoff) => {
        const { user: signedIn } = await redeemGoogleSignIn(handoff);
        setUser(signedIn);
        setStatus('authenticated');
        return signedIn;
      },
      signOut: async () => {
        await logoutRequest();
        setUser(null);
        setStatus('anonymous');
      },
    }),
    [status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = React.useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

/** Just the status, for components that only care whether to render. */
export const useAuthState = (): AuthStatus => useAuth().status;
