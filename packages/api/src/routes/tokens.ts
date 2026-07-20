import { randomBytes } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { canInitiatePatchJob } from '@patchback/types';

import {
  DEFAULT_MAX_TOKEN_TTL_MS,
  DEFAULT_TOKEN_TTL_MS,
  mintBrowserToken,
  type MintableTier,
} from '../browser-token.js';
import type { ApiConfig } from '../config.js';
import { ApiError } from '../errors.js';
import { tierAtMost } from '../trust.js';

/** Smallest sane token lifetime — a requested TTL is floored here. */
const MIN_TTL_MS = 1000;

interface ExchangeBody {
  tier?: MintableTier;
  ttlMs?: number;
  subject?: string;
}

/**
 * The resolved exchange config: a concrete secret (explicit or ephemeral) and
 * effective TTL bounds. Built ONCE in `server.ts` so the verifier and the
 * minting route share the exact same secret.
 */
export interface ResolvedTokenExchange {
  secret: string;
  defaultTtlMs: number;
  maxTtlMs: number;
}

/**
 * Resolve `config.tokenExchange` into a concrete secret + TTL bounds. When no
 * `signingSecret` is configured, generate an ephemeral per-process secret and
 * log the horizontal-scaling caveat (dev-friendly: keeps `patchback dev`
 * zero-config while being explicit about the restart/multi-instance tradeoff).
 */
export function resolveTokenExchange(config: ApiConfig): ResolvedTokenExchange {
  const te = config.tokenExchange;
  if (te === undefined) {
    throw new Error('resolveTokenExchange called without tokenExchange config');
  }
  let secret = te.signingSecret;
  if (secret === undefined) {
    secret = randomBytes(32).toString('hex');
    config.log?.(
      'tokenExchange: no signingSecret configured — generated an ephemeral ' +
        'per-process secret. Minted tokens will NOT survive a restart, and ' +
        'every instance in a multi-instance deployment will reject the ' +
        "others' tokens. Set tokenExchange.signingSecret for production.",
    );
  }
  const maxTtlMs = te.maxTtlMs ?? DEFAULT_MAX_TOKEN_TTL_MS;
  const defaultTtlMs = te.defaultTtlMs ?? Math.min(DEFAULT_TOKEN_TTL_MS, maxTtlMs);
  return { secret, defaultTtlMs, maxTtlMs };
}

/**
 * POST /tokens/exchange — the server-to-server minting endpoint for
 * public-facing apps. Registered ONLY when `config.tokenExchange` is set.
 *
 * THREAT MODEL: a successful call mints a tier-bearing token, so this is the
 * most sensitive surface in the API. A browser must NEVER be able to call it
 * directly, or it could mint itself a token. Enforcement is layered:
 *
 *  1. Parent key required (primary): `via === 'api-key'` AND patch-eligible.
 *     A browser does not hold the parent key — that is the whole point of the
 *     phase. This ALSO blocks token-chaining: a request authenticated by a
 *     browser token (via === 'browser-token') is rejected, so a minted token
 *     can never mint further tokens.
 *  2. Active browser-indicator rejection (defense-in-depth): any `Origin` or
 *     `Sec-Fetch-*` header ⇒ 403 `server_only`. These are forbidden header
 *     names that page JavaScript cannot set or spoof; a server-to-server
 *     client simply omits them.
 *  3. Never CORS-exposed: an `onSend` hook strips every CORS header from this
 *     route's responses, so even with `cors` configured a preflight gets no
 *     `Access-Control-Allow-Origin` and the browser blocks the real request
 *     before our 403 ever fires.
 */
export function registerTokenRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  resolved: ResolvedTokenExchange,
): void {
  const now = (): Date => config.now?.() ?? new Date();

  // Layer 3: this route is never CORS-exposed. Strip any CORS headers the
  // global @fastify/cors plugin may have reflected (including on a preflight
  // it short-circuits), so there is no configuration that exposes it.
  app.addHook('onSend', async (request, reply, payload) => {
    if (pathOnly(request.url) === '/tokens/exchange') {
      reply.removeHeader('access-control-allow-origin');
      reply.removeHeader('access-control-allow-methods');
      reply.removeHeader('access-control-allow-headers');
      reply.removeHeader('access-control-expose-headers');
      reply.removeHeader('access-control-allow-credentials');
    }
    return payload;
  });

  app.post<{ Body: ExchangeBody }>(
    '/tokens/exchange',
    {
      preHandler: rejectBrowserOrigin,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            // `outsider` is unrepresentable — the enum makes it a schema 400.
            tier: { type: 'string', enum: ['owner', 'insider'] },
            ttlMs: { type: 'number', minimum: 1 },
            subject: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      // Layer 1: a REAL parent API key is required. This rejects keyless
      // callers, outsiders, AND browser tokens (no chaining) in one check.
      if (request.auth.via !== 'api-key' || !canInitiatePatchJob(request.auth.tier)) {
        throw new ApiError(
          403,
          'tier_forbidden',
          'POST /tokens/exchange requires a valid owner or insider API key; ' +
            'a browser token cannot mint further tokens',
        );
      }
      const parentTier = request.auth.tier;
      const requested = request.body.tier ?? parentTier;

      // Tier ceiling: a minted token can never exceed the parent key's tier.
      // Reject loudly (403), never silently clamp.
      if (!tierAtMost(requested, parentTier)) {
        throw new ApiError(
          403,
          'tier_ceiling',
          `requested tier "${requested}" exceeds the parent key's tier ` +
            `"${parentTier}" — a token can never be more trusted than the key ` +
            'that mints it',
        );
      }

      const ttlMs = clampTtl(request.body.ttlMs, resolved);
      const minted = mintBrowserToken({
        tier: requested as MintableTier,
        ttlMs,
        secret: resolved.secret,
        now,
        ...(request.body.subject !== undefined
          ? { subject: request.body.subject }
          : {}),
      });
      return reply.status(201).send({
        token: minted.token,
        tier: requested,
        expiresAt: minted.expiresAt,
      });
    },
  );
}

/**
 * Layer 2: reject anything carrying a browser-fetch indicator. `Origin` and
 * `Sec-Fetch-*` are forbidden header names — a page cannot set or remove them,
 * so a browser cannot disguise itself as a server, and a server-to-server
 * client never sends them.
 */
async function rejectBrowserOrigin(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const h = request.headers;
  if (
    h.origin !== undefined ||
    h['sec-fetch-site'] !== undefined ||
    h['sec-fetch-mode'] !== undefined ||
    h['sec-fetch-dest'] !== undefined
  ) {
    throw new ApiError(
      403,
      'server_only',
      '/tokens/exchange is a server-to-server endpoint and must never be ' +
        'called from a browser',
    );
  }
}

/** Clamp a requested TTL into `[MIN_TTL_MS, maxTtlMs]`; default when omitted. */
function clampTtl(
  requested: number | undefined,
  resolved: ResolvedTokenExchange,
): number {
  if (requested === undefined) {
    return resolved.defaultTtlMs;
  }
  return Math.max(MIN_TTL_MS, Math.min(requested, resolved.maxTtlMs));
}

function pathOnly(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}
