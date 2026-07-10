/**
 * Default ModelCaller backed by the official Anthropic SDK.
 *
 * This is the ONLY file in @patchback/triage that imports a vendor SDK.
 * Everything else depends on the vendor-neutral `ModelCaller` seam in
 * `model.ts`, so a vendor swap touches exactly this file.
 */
import Anthropic from '@anthropic-ai/sdk';

import { TriageModelError, type ModelCaller } from './model.js';

/**
 * Default model for triage. Classification quality is the security control
 * here, so we do not silently default to a cheaper tier — pin a cheaper model
 * via options once the evals prove it out (a config decision, not a default).
 */
export const DEFAULT_TRIAGE_MODEL = 'claude-opus-4-8';

export interface AnthropicModelCallerOptions {
  /**
   * Defaults to `process.env.ANTHROPIC_API_KEY` — read here, at the vendor
   * boundary, and nowhere else in the package.
   */
  apiKey?: string;
  /** Model id, default {@link DEFAULT_TRIAGE_MODEL}. */
  model?: string;
  /** SDK retry count for 429/5xx with retry-after handling. Default: SDK's. */
  maxRetries?: number;
}

/**
 * Map any failure from the SDK (typed API errors, connection errors, or
 * anything else) onto the vendor-neutral {@link TriageModelError}. Factored
 * out so error mapping is unit-testable without network or SDK error
 * construction.
 */
export function toTriageModelError(error: unknown): TriageModelError {
  if (error instanceof TriageModelError) {
    return error;
  }
  const status =
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return new TriageModelError(
    status !== undefined
      ? `triage model call failed (HTTP ${status}): ${message}`
      : `triage model call failed: ${message}`,
    { cause: error },
  );
}

/**
 * Create the default Anthropic-backed model caller.
 *
 * One Messages API call per classification: frozen system prompt, adaptive
 * thinking at low effort (helps on the genuinely ambiguous middle bucket
 * while keeping latency down), structured output constrained to the triage
 * schema.
 */
export function createAnthropicModelCaller(
  options: AnthropicModelCallerOptions = {},
): ModelCaller {
  const client = new Anthropic({
    apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
    ...(options.maxRetries !== undefined
      ? { maxRetries: options.maxRetries }
      : {}),
  });
  const model = options.model ?? DEFAULT_TRIAGE_MODEL;

  return async (request) => {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: request.maxTokens,
        system: request.system,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'low',
          format: {
            type: 'json_schema',
            schema: request.outputSchema,
          },
        },
        messages: [{ role: 'user', content: request.user }],
      });
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');
      return { text };
    } catch (error) {
      throw toTriageModelError(error);
    }
  };
}
