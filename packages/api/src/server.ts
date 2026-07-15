import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

import { resolveAuth, type RequestAuth } from './auth.js';
import { validateConfig, type ApiConfig } from './config.js';
import { ApiError, StoreIntegrityError } from './errors.js';
import { registerFeedbackRoutes } from './routes/feedback.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerWebhookRoutes } from './routes/webhooks.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: RequestAuth;
  }
}

/**
 * Build the Fastify app. Pure over its config: no `process.env`, no vendor
 * SDKs, no implicit services — everything arrives through {@link ApiConfig}.
 *
 * Security posture baked in here:
 * - Tier resolution runs on EVERY request (onRequest hook), server-side only.
 * - Ajv is configured to REJECT unknown body properties (removeAdditional
 *   off), so a client-supplied `trustTier` is a loud 400, never silently
 *   dropped.
 * - The webhook route exists only when a secret is configured, and its
 *   handler is wired without a GitHubClient (state flows in, never out).
 */
export function buildServer(config: ApiConfig): FastifyInstance {
  validateConfig(config);

  const app = Fastify({
    // Feedback bodies are capped by schema (capture ≤ 512 KiB screenshot);
    // this is the transport-level backstop.
    bodyLimit: 1024 * 1024,
    ajv: {
      customOptions: {
        // Fastify's default is removeAdditional — we want additional
        // properties to FAIL validation instead, so nobody builds against
        // the false assumption that clients may send e.g. `trustTier`.
        removeAdditional: false,
        coerceTypes: false,
      },
    },
  });

  if (config.cors !== undefined) {
    // Explicitly configured origins only (validated: never a wildcard).
    // `credentials: false` — the API authenticates with Authorization
    // headers set by page script, never cookies, so reflecting credentials
    // is neither needed nor wanted.
    void app.register(cors, {
      origin: [...config.cors.allowedOrigins],
      methods: ['GET', 'POST', 'OPTIONS'],
      credentials: false,
    });
  }

  app.decorateRequest('auth', null as unknown as RequestAuth);
  app.addHook('onRequest', async (request) => {
    request.auth = resolveAuth(
      request.headers.authorization,
      config.apiKeys ?? [],
    );
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof ApiError) {
      return reply
        .status(error.statusCode)
        .send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof StoreIntegrityError) {
      request.log.error(error);
      return reply
        .status(500)
        .send({ error: { code: 'integrity', message: error.message } });
    }
    if (error instanceof Error) {
      const fastifyError = error as Error & {
        validation?: unknown;
        statusCode?: number;
      };
      if (fastifyError.validation !== undefined) {
        return reply
          .status(400)
          .send({ error: { code: 'validation', message: error.message } });
      }
      if (
        fastifyError.statusCode !== undefined &&
        fastifyError.statusCode >= 400 &&
        fastifyError.statusCode < 500
      ) {
        return reply.status(fastifyError.statusCode).send({
          error: { code: 'validation', message: error.message },
        });
      }
    }
    request.log.error(error);
    return reply
      .status(500)
      .send({ error: { code: 'internal', message: 'internal server error' } });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply
      .status(404)
      .send({ error: { code: 'not_found', message: 'route not found' } });
  });

  registerFeedbackRoutes(app, config);
  registerJobRoutes(app, config);
  if (config.webhookSecret !== undefined) {
    registerWebhookRoutes(app, {
      webhookSecret: config.webhookSecret,
      store: config.store,
      // A plain value (owner/repo) for event correlation — deliberately NOT
      // the GitHubClient: the webhook path has zero outbound capability.
      repo: config.githubClient.repo,
    });
  }

  return app;
}
