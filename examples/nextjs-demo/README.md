# nextjs-demo — fake ops dashboard

A small Next.js 15 "internal ops" dashboard (orders table, synthetic data)
embedding the Patchback widget. This is the app the demo GIF is shot on —
the exact click-by-click script lives in [docs/demo-flow.md](../../docs/demo-flow.md).

It deliberately ships three small flaws for the feedback → PR loop to fix:

1. Orders table column header typo: **"Ammount"**
   (`app/components/orders-dashboard.tsx`).
2. Wrong default sort — oldest orders first (`lib/orders.ts`, `sortOrders`).
3. The **"Pending only"** filter actually shows shipped orders
   (`statusForFilter` in `app/components/orders-dashboard.tsx`).

The smoke tests do not pin these flaws, so a demo PR fixing one stays green.

## Run it

```sh
# 1. From the repo root, build the workspace and start the local API:
pnpm install && pnpm build
node packages/cli/dist/index.js dev        # runs `patchback init` first time

# 2. Copy the INSIDER dev key from the banner into .env.local:
cp examples/nextjs-demo/.env.example examples/nextjs-demo/.env.local
#    ...and paste the key into NEXT_PUBLIC_PATCHBACK_API_KEY

# 3. Start the app (default origin http://localhost:3000 is already in the
#    CORS allow-list `patchback init` writes):
pnpm --filter nextjs-demo dev
```

The widget loads from the local API via the same snippet `patchback dev`
prints (`app/components/patchback-snippet.tsx`); the key is env-injected
because it is minted per run.

## Source provenance (dev)

This example wires `@patchback/provenance` so `next dev` stamps every host
element with `data-pb-source="<repo-relative-file>:<line>"` and a picked
element carries a real `sourceHint` into the feedback payload:

- `tsconfig.json` sets `"jsxImportSource": "@patchback/provenance"` — Next's
  SWC reads it (the same mechanism Emotion uses; SWC stays enabled, and it
  works under both webpack dev and `next dev --turbopack`).
- `next.config.mjs` wraps the config with `withPatchbackProvenance(...)`,
  which injects the discovered repo root (nearest `.git` ancestor) in the
  dev phase only.

Production builds stamp nothing: the prod JSX runtime carries no source
info, so stripping is structural, not a flag. The smoke tests assert
structure only and never pin line numbers, so edits here stay green.
