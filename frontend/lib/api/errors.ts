/**
 * The backend returns every error in ONE envelope (see backend core.errors):
 *   { "error": { "code": "...", "message": "...", "details": { ... } } }
 * `ApiError` normalises that into a typed exception the UI can branch on
 * (toast vs inline field errors) by `code` / `status`.
 */

export type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** A user-safe message for any thrown value — for toasts/inline errors. */
export function errorMessage(error: unknown): string {
  if (isApiError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}
