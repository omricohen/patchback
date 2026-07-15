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
