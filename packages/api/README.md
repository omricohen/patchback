# @patchback/api

Fastify API for [Patchback](https://github.com/omricohen/patchback): feedback
intake, patch jobs, and GitHub webhooks.

Routes:

- `POST /feedback`, `GET /feedback/:id`, `POST /feedback/:id/reply`
- `POST /jobs/:id/start`, `GET /jobs/:id/status`
- `POST /webhooks/github`

Trust tiers are enforced server-side: `outsider` feedback can never create a
patch job, regardless of what the client sends. There is no auto-merge path
anywhere in the API.

Storage and queueing are pluggable behind small interfaces:

- Default: in-memory store + in-memory queue (what `npx patchback dev` uses —
  no Postgres, no Redis).
- `@patchback/api/drizzle` — Postgres via Drizzle.
- `@patchback/api/bullmq` — BullMQ (Redis) queue.
- `@patchback/api/testing` — helpers for integration tests.

```ts
import { buildServer, createWorkers } from '@patchback/api';

const app = buildServer(config); // a Fastify instance
await app.listen({ port: 8787 });
```

Most users should start with the [`patchback` CLI](https://github.com/omricohen/patchback/tree/main/packages/cli#readme),
which wires this up. MIT licensed.
