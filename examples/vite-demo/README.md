# vite-demo — minimal vanilla embed

The smallest useful embedding of `@patchback/widget`: a static page, a
package import, one `createPatchbackWidget` call (`src/main.ts`). One
seeded flaw ("Whats new" header, missing apostrophe) gives the feedback →
PR loop something to fix.

## Run it

```sh
# 1. From the repo root, build the workspace and start the local API:
pnpm install && pnpm build
node packages/cli/dist/index.js dev        # runs `patchback init` first time

# 2. Copy the INSIDER dev key from the banner into .env.local:
cp examples/vite-demo/.env.example examples/vite-demo/.env.local
#    ...and paste the key into VITE_PATCHBACK_API_KEY

# 3. Allow this app's origin in patchback.config.ts (the widget calls the
#    API cross-origin):
#      appOrigins: ['http://localhost:3000', 'http://localhost:5174']
#    then restart `patchback dev`.

# 4. Start the app:
pnpm --filter vite-demo dev                # http://localhost:5174
```

## Source provenance without JSX (manual contract)

This app has no JSX, so the `@patchback/provenance` build plugin has nothing
to stamp. The attribute it emits is a public DOM contract, not a plugin
detail — any app may stamp elements by hand:

```html
<button data-pb-source="examples/vite-demo/src/page.ts:12">Save</button>
```

Rules for a hand-written `data-pb-source` value:

- `relative/path/from/REPO/root.ext:LINE` — forward slashes, 1-based line;
- relative only (never `/abs`, `C:\`, or `~`), no `.`/`..` or dot-prefixed
  segments, no `node_modules`;
- extension must be a source file (`.ts`, `.tsx`, `.js`, `.vue`, …).

Invalid values are ignored by the widget (validated client- and
server-side), and the element picker falls back to the nearest annotated
ancestor, so a single stamp on a container covers its children. This demo
intentionally leaves its seeded flaw unstamped — keeping one hint-free
example app is useful coverage — but you can add the attribute to
`src/page.ts` markup if you want to see the hint flow end to end.
