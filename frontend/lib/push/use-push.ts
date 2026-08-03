'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  detectPushSupport,
  fetchPushConfig,
  subscribeToPush,
  unsubscribeFromPush,
  type PushSupport,
} from '@/lib/api/push';
import { useAuthState } from '@/lib/auth/auth-provider';

/**
 * The one place that knows whether push is actually available.
 *
 * Five things all have to be true, and every one of them can be false in
 * normal use. Collapsing them into a boolean is what produced a card that
 * said "notifications are on" when they were not, so the state is an explicit
 * union and each value has its own sentence in the UI:
 *
 * - `loading`       still asking the server
 * - `unavailable`   the SERVER has no VAPID keys — push cannot be sent here
 * - `unsupported`   the BROWSER has no push (older Safari, in-app browsers)
 * - `insecure`      not a secure context; push requires https
 * - `signed-out`    a subscription belongs to an account
 * - `blocked`       the person denied permission in browser settings
 * - `off`           everything works; not subscribed yet
 * - `on`            subscribed, stored server-side, and sendable
 *
 * `on` is the ONLY state reached after the server has stored the
 * subscription. It is never inferred from the browser permission alone.
 */
export type PushState =
  | 'loading'
  | 'unavailable'
  | 'unsupported'
  | 'insecure'
  | 'signed-out'
  | 'blocked'
  | 'off'
  | 'on';

type BrowserPermission = 'default' | 'granted' | 'denied' | 'unknown';

function readPermission(): BrowserPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unknown';
  return Notification.permission as BrowserPermission;
}

export function usePush() {
  const auth = useAuthState();
  const [support, setSupport] = React.useState<PushSupport | null>(null);
  const [permission, setPermission] = React.useState<BrowserPermission>('unknown');
  const [subscribed, setSubscribed] = React.useState<boolean | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Server-side capability, asked BEFORE anything touches the browser. A
  // deployment with no VAPID keys must never see a permission prompt.
  const config = useQuery({
    queryKey: ['push', 'config'],
    queryFn: fetchPushConfig,
    staleTime: 300_000,
    retry: 1,
  });

  React.useEffect(() => {
    setSupport(detectPushSupport());
    setPermission(readPermission());
  }, []);

  // Whether THIS browser already holds a subscription. Read from the browser
  // rather than from the server's device list: the server knows about devices
  // in general, only the browser knows about this one.
  React.useEffect(() => {
    if (support !== 'supported') return;
    let cancelled = false;
    void navigator.serviceWorker
      .getRegistration('/')
      .then((registration) => registration?.pushManager.getSubscription() ?? null)
      .then((subscription) => {
        if (!cancelled) setSubscribed(Boolean(subscription));
      })
      .catch(() => {
        if (!cancelled) setSubscribed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [support]);

  const state: PushState = React.useMemo(() => {
    if (config.isPending || support === null) return 'loading';
    // A failed config request is treated as unavailable rather than assumed
    // working — offering a control that cannot succeed is the failure mode
    // this whole hook exists to prevent.
    if (config.isError || !config.data?.enabled || !config.data.public_key) return 'unavailable';
    if (support === 'insecure') return 'insecure';
    if (support === 'unsupported') return 'unsupported';
    if (auth !== 'authenticated') return 'signed-out';
    if (permission === 'denied') return 'blocked';
    if (subscribed === null) return 'loading';
    return subscribed ? 'on' : 'off';
  }, [config.isPending, config.isError, config.data, support, auth, permission, subscribed]);

  const enable = React.useCallback(async () => {
    const key = config.data?.public_key;
    if (!key) return;
    setBusy(true);
    setError(null);
    try {
      // Permission is requested HERE — after the server said it can send and
      // after the user pressed a button. Never on page load.
      const granted = await Notification.requestPermission();
      setPermission(granted as BrowserPermission);
      if (granted !== 'granted') return;

      await subscribeToPush(key);
      setSubscribed(true);
    } catch (thrown) {
      // Named, not swallowed. The person needs to know it did not work.
      setError(
        thrown instanceof Error ? thrown.message : 'Could not turn on notifications. Try again.',
      );
      setSubscribed(false);
    } finally {
      setBusy(false);
    }
  }, [config.data?.public_key]);

  const disable = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await unsubscribeFromPush();
      setSubscribed(false);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : 'Could not turn notifications off.');
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, busy, error, enable, disable };
}
