/**
 * The vendor-neutral model-call seam.
 *
 * The classifier core, the prompt/schema/threshold modules, and every unit
 * test depend only on this file. No vendor SDK types leak through it — the
 * default Anthropic implementation lives in `anthropic.ts`, the ONLY file in
 * this package allowed to import a vendor SDK.
 */

/** A fully-assembled request for one classification call. */
export interface ModelRequest {
  /** Frozen system prompt (byte-identical across calls, cache-friendly). */
  system: string;
  /** Assembled user message; untrusted data already wrapped in DATA blocks. */
  user: string;
  /** JSON schema the model's structured output must match. */
  outputSchema: Record<string, unknown>;
  maxTokens: number;
}

export interface ModelResponse {
  /**
   * Raw text of the model's (structured) output. Parsing and validation
   * happen in `schema.ts` — never trust even structured output.
   */
  text: string;
}

/** The injectable model-call function. Tests inject plain fakes. */
export type ModelCaller = (request: ModelRequest) => Promise<ModelResponse>;

/**
 * Transport/API failure (timeouts, 429/5xx after retries, auth). Thrown, not
 * classified — the caller (worker in Phase 6, eval runner now) owns retry
 * policy. A transport error must NEVER resolve to a classification, so it can
 * never resolve toward `patchable`.
 */
export class TriageModelError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'TriageModelError';
    this.cause = options?.cause;
  }
}
