import { API_BASE_URL } from './config';
import { ApiError, type ApiErrorEnvelope } from './errors';
import { tokenStore } from './token-store';
import type { TokenPair } from './types';

const API_ROOT = `${API_BASE_URL}/api/v1`;

/** Next.js' fetch extensions (ISR). Typed here rather than relying on the
 * ambient augmentation so this file compiles the same in tests. */
type NextFetchOptions = { revalidate?: number | false; tags?: string[] };

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** Attach the access token. Default true; pass false for public reads. */
  auth?: boolean;
  signal?: AbortSignal;
  /** Fetch cache mode. Defaults to `no-store` — the only safe default when a
   * response may be per-user. Public reads opt in explicitly (see `next`). */
  cache?: RequestCache;
  /**
   * Next's ISR controls, for PUBLIC reads rendered on the server. Passing this
   * drops the `no-store` default so the route can actually be revalidated on a
   * timer — keep the interval aligned with the backend's own `s-maxage` for
   * that endpoint (see lib/api/events.ts).
   */
  next?: NextFetchOptions;
};

function buildInit(opts: RequestOptions): RequestInit {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  // FormData passes straight through. Setting `Content-Type` ourselves would be
  // actively harmful here: multipart needs a `boundary=` parameter that only
  // the browser can generate, and naming the type without it makes the server
  // fail to find any parts at all. The upload endpoints (`poster` on
  // create/update event) are the only callers that need this.
  const multipart = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  if (opts.body !== undefined && !multipart) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false) {
    const token = tokenStore.getAccess();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return {
    method: opts.method ?? 'GET',
    headers,
    body:
      opts.body === undefined
        ? undefined
        : multipart
          ? (opts.body as FormData)
          : JSON.stringify(opts.body),
    signal: opts.signal,
    // `no-store` unless the caller explicitly opted into an ISR-cached read;
    // setting both `cache` and `next.revalidate` is a Next-level conflict.
    cache: opts.cache ?? (opts.next ? undefined : 'no-store'),
    ...(opts.next ? { next: opts.next } : {}),
  } as RequestInit;
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    // Parse the error body DEFENSIVELY. A 502 from a proxy, a gateway timeout
    // or a load-balancer error page is HTML, not the envelope — and parsing it
    // before checking `res.ok` used to throw a SyntaxError, which callers
    // could only read as "network down": the wrong diagnosis, with the wrong
    // remedy attached. A non-JSON error body is still an HTTP answer, so it
    // becomes a typed ApiError carrying the status.
    let envelope: Partial<ApiErrorEnvelope> | null = null;
    if (text) {
      try {
        envelope = JSON.parse(text) as Partial<ApiErrorEnvelope>;
      } catch {
        // Not the envelope, not even JSON. The generic error below stands.
      }
    }
    const err = envelope?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'http_error',
      err?.message ?? (res.statusText || `The server returned an error (${res.status}).`),
      err?.details ?? {},
    );
  }
  // A non-JSON 2xx is a broken contract with the backend, not a user-facing
  // condition — let JSON.parse's own exception propagate so it gets
  // investigated rather than rendered as an error message.
  const data = text ? (JSON.parse(text) as unknown) : null;
  return data as T;
}

// De-dupe concurrent refreshes so a burst of 401s triggers exactly one refresh.
let refreshInFlight: Promise<boolean> | null = null;

async function doRefresh(refresh: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_ROOT}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refresh }),
    });
    if (!res.ok) {
      tokenStore.clear();
      return false;
    }
    const pair = (await res.json()) as TokenPair;
    tokenStore.set(pair.access, pair.refresh);
    return true;
  } catch {
    return false;
  }
}

function tryRefresh(): Promise<boolean> {
  const refresh = tokenStore.getRefresh();
  if (!refresh) return Promise.resolve(false);
  if (!refreshInFlight) {
    refreshInFlight = doRefresh(refresh).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** Typed fetch to the backend. Attaches auth, transparently refreshes once on a
 * 401, and turns the error envelope into a typed {@link ApiError}. */
export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = `${API_ROOT}${path}`;
  let res = await fetch(url, buildInit(opts));
  if (res.status === 401 && opts.auth !== false && tokenStore.getRefresh()) {
    const refreshed = await tryRefresh();
    if (refreshed) res = await fetch(url, buildInit(opts));
  }
  return parse<T>(res);
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => apiFetch<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    apiFetch<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    apiFetch<T>(path, { ...opts, method: 'PATCH', body }),
  delete: <T>(path: string, opts?: RequestOptions) =>
    apiFetch<T>(path, { ...opts, method: 'DELETE' }),
};

/** Liveness ping to the backend's /health/ (outside /api/v1). */
export async function ping(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/health/`, { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

// `BASE_URL` is re-exported under its original name so existing importers keep
// working; `lib/api/config` is where it is actually resolved now.
export { API_ROOT, API_BASE_URL as BASE_URL };
