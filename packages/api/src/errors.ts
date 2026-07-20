/**
 * Error vocabulary for the API.
 *
 * Route handlers throw `ApiError` with a stable machine-readable `code`; the
 * server's error handler maps it to `{ error: { code, message } }`. Codes are
 * part of the public contract — the widget keys on them.
 */

export const API_ERROR_CODES = [
  'validation',
  'unauthorized',
  'not_found',
  'tier_forbidden',
  'tier_ceiling',
  'server_only',
  'triage_gate',
  'invalid_state',
  'conflict',
  'integrity',
  'internal',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;

  constructor(statusCode: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function notFound(what: string): ApiError {
  return new ApiError(404, 'not_found', `${what} not found`);
}

/**
 * Thrown when a value read back from storage fails runtime validation
 * (unknown trust tier, unknown job state, malformed history). This can only
 * mean corruption or a bad migration — fail closed, never coerce toward a
 * runnable state or an eligible tier.
 */
export class StoreIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreIntegrityError';
  }
}
