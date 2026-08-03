import { api } from './client';

/**
 * Web Push, client side.
 *
 * The subscribe card used to call `Notification.requestPermission()` and then
 * say "Notifications are on for this device". The permission was real; the
 * capability was not. Nothing subscribed, nothing was stored, and nothing
 * could ever be sent — so the one sentence on that card that a person would
 * act on was false.
 *
 * The order of operations here is the fix, and it is deliberate:
 *
 *   1. ask the SERVER whether push is configured at all;
 *   2. only then register a service worker;
 *   3. only then ask the browser for permission;
 *   4. only then subscribe, and hand the subscription to the server;
 *   5. report "on" only once step 4 has been stored.
 *
 * Asking for permission before knowing the server can send is what produced
 * the original problem. A browser permission is not a feature — it is
 * consent to use one.
 */

export type PushConfig = { enabled: boolean; public_key: string };

export type PushDevice = {
  id: string;
  user_agent: string;
  created_at: string;
  last_used_at: string | null;
};

/** Whether this deployment can send push, and the key to subscribe with. */
export const fetchPushConfig = () => api.get<PushConfig>('/push/config', { auth: false });

export const fetchPushDevices = () => api.get<{ data: PushDevice[] }>('/me/push/subscriptions');

export const savePushSubscription = (input: {
  endpoint: string;
  p256dh: string;
  auth: string;
}) => api.post<PushDevice>('/me/push/subscriptions', input);

export const deletePushSubscription = (endpoint: string) =>
  api.delete<void>('/me/push/subscriptions', { body: { endpoint } });

/**
 * The VAPID public key arrives as unpadded base64url; `applicationServerKey`
 * wants raw bytes. Chrome rejects the string form with an error that names
 * neither the encoding nor the fix, so this conversion is not optional and is
 * worth having in one place.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const standard = padded.replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(standard);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
  return output;
}

export type PushSupport =
  | 'supported'
  | 'unsupported' // the browser has no push at all (older Safari, most in-app browsers)
  | 'insecure'; // push requires a secure context; http://localhost counts as one

export function detectPushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  return 'supported';
}

/** Register the worker that receives pushes. Root scope — see app/sw.js. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

/**
 * Subscribe this browser and store it. Returns the endpoint.
 *
 * Every failure path throws with a sentence a person could act on, because
 * the alternative — a silent catch and an optimistic "you're all set" — is
 * the exact defect this replaced.
 */
export async function subscribeToPush(publicKey: string): Promise<string> {
  const registration = await registerServiceWorker();
  // `ready` rather than the register() result: a freshly registered worker is
  // still installing, and `pushManager.subscribe` on one that has not
  // activated fails intermittently — the kind of bug that only appears on a
  // first visit and never in testing.
  await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      // Required by Chrome. Subscribing without it means a silent push, which
      // browsers permit only under a separate, revocable grant — and using it
      // to avoid showing a notification is what gets a site's push privileges
      // taken away.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('This browser returned an incomplete push subscription.');
  }

  await savePushSubscription({
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  });
  return json.endpoint;
}

/** Unsubscribe this browser, locally and on the server. */
export async function unsubscribeFromPush(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  const { endpoint } = subscription;
  // Server first. If the browser drops it and then the DELETE fails, the row
  // survives pointing at an endpoint nobody can revoke — the push service
  // would eventually 410 it, but "eventually" is not a promise to make about
  // somebody asking to stop being contacted.
  await deletePushSubscription(endpoint);
  await subscription.unsubscribe();
}
