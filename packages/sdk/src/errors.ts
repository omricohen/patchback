/**
 * Error surface of the SDK.
 *
 * A non-2xx response from the API becomes a {@link PatchbackApiError} with
 * the parsed `{ code, message }` body and the HTTP status. Malformed error
 * bodies fail closed to `code: 'unknown'`. Network errors (no server,
 * DNS, aborted request) propagate as-is so callers can distinguish
 * "server said no" from "no server".
 */
export class PatchbackApiError extends Error {
  /** HTTP status code of the response. */
  readonly status: number;
  /** Machine-readable error code from the API's error vocabulary. */
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'PatchbackApiError';
    this.status = status;
    this.code = code;
  }
}

/** Parse an API error body, failing closed to `unknown` on malformed input. */
export function apiErrorFromBody(
  status: number,
  body: unknown,
): PatchbackApiError {
  if (body !== null && typeof body === 'object' && 'error' in body) {
    const error = (body as { error: unknown }).error;
    if (error !== null && typeof error === 'object') {
      const record = error as Record<string, unknown>;
      const code = typeof record.code === 'string' ? record.code : 'unknown';
      const message =
        typeof record.message === 'string'
          ? record.message
          : `request failed with status ${status}`;
      return new PatchbackApiError(status, code, message);
    }
  }
  return new PatchbackApiError(
    status,
    'unknown',
    `request failed with status ${status}`,
  );
}
