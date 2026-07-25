import { ApiError, type ApiErrorEnvelope } from './errors';
import { tokenStore } from './token-store';
import type { TokenPair } from './types';

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';
const API_ROOT = `${BASE_URL}/api/v1`;

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** Attach the access token. Default true; pass false for public reads. */
  auth?: boolean;
  signal?: AbortSignal;
};

function buildInit(opts: RequestOptions): RequestInit {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false) {
    const token = tokenStore.getAccess();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
    cache: 'no-store',
  };
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const envelope = data as Partial<ApiErrorEnvelope> | null;
    const err = envelope?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'http_error',
      err?.message ?? res.statusText ?? 'Request failed',
      err?.details ?? {},
    );
  }
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
    const res = await fetch(`${BASE_URL}/health/`, { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

export { API_ROOT, BASE_URL };
