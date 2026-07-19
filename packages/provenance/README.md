# @patchback/provenance

Build-time source provenance for [Patchback](https://github.com/omricohen/patchback):
stamp rendered host elements with

```html
<button data-pb-source="src/components/Toolbar.tsx:42">Save</button>
```

so the widget's element picker can attach a real `file:line` (`sourceHint`)
to feedback, and the patch agent starts at the exact source location instead
of reconstructing it from DOM paths.

## How it works (mechanism)

The React automatic **dev** transform — babel, esbuild, oxc, and SWC alike —
calls `jsxDEV(type, props, key, isStatic, source, self)` with
`source = { fileName, lineNumber, columnNumber }`. This package ships a
`jsx-dev-runtime` wrapper that reads that argument, stamps
`data-pb-source="<repo-root-relative-file>:<line>"` onto **host elements
only** (`typeof type === 'string'`), and delegates to React's own runtime.
Activate it by pointing `jsxImportSource` at this package.

Because dependencies in `node_modules` are pre-compiled against React's own
runtime, **only first-party app code gets stamped** — for free.

### Vite

```ts
// vite.config.ts
import { patchbackProvenance } from '@patchback/provenance/vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react({ jsxImportSource: '@patchback/provenance' }),
    patchbackProvenance(),
  ],
});
```

`@vitejs/plugin-react` owns the JSX pipeline, so the import source is passed
to `react()` directly; `patchbackProvenance()` injects the repo root in dev
and is inert in builds. Without plugin-react (plain esbuild/oxc JSX), the
plugin sets the import source itself.

### Next.js

```jsonc
// tsconfig.json — Next's SWC reads this (same mechanism Emotion uses;
// SWC stays enabled, works with webpack dev AND `next dev --turbopack`)
{ "compilerOptions": { "jsxImportSource": "@patchback/provenance" } }
```

```js
// next.config.mjs
import { withPatchbackProvenance } from '@patchback/provenance/next';
export default withPatchbackProvenance(nextConfig);
```

The helper injects the discovered repo root (dev phase only).

### Babel (escape hatch / production opt-in)

```js
plugins: [['@patchback/provenance/babel', { root, elements: 'all' }]];
```

A static plugin that injects the attribute at compile time. Use it when the
jsx-runtime mechanism is unavailable (an app already using a custom
`jsxImportSource` like Emotion's, classic runtime setups) or for the
production opt-in below.

## Path privacy — relative paths only, fail closed

`fileName` is **absolute** at transform time (`/Users/you/dev/app/src/…`).
Absolute paths leak usernames and machine layout and must never appear in
the DOM, the payload, or an agent brief. The runtime therefore emits a stamp
**only** when the fileName can be cleanly relativized against the injected
repo root (or is already root-relative, as Turbopack emits) and the result
passes the shared validator. Unknown root, outside-root file,
`node_modules`, or any residual absolute form ⇒ **no attribute**. A test
pins that no emitted value ever starts with `/`, a drive letter, or `~`.

The relativization root defaults to the **nearest ancestor directory
containing `.git`** — repo-root-relative, not app-relative, because the
agent pipeline clones the repository root (in a monorepo,
`apps/web/src/page.tsx`-shaped hints resolve; `src/page.tsx`-shaped ones
would not). Worktrees, submodules, and nested repos can override with the
`root` option.

## Production posture

- **Default: stripped.** Production builds use `jsx-runtime`, which carries
  no source info; this package's `jsx-runtime` entry is a pure passthrough
  to React's. There is no flag to forget — stripping is structural.
- **Opt-in for internal apps:** `patchbackProvenance({ production:
'annotate' })` (Vite) or registering the babel plugin in a production
  build stamps statically. Informed trade-off: it discloses repo-relative
  file structure to anyone who can view source. The `elements:
'interactive'` option bounds DOM cost to interactive tags
  (`a button input select textarea form label summary details`).

## Manual contract (non-JSX apps)

`data-pb-source` is a public DOM contract, not a plugin detail. Vue, Svelte,
server-rendered, or vanilla apps may stamp it by hand:

- format `relative/path/from/repo/root.ext:LINE` (forward slashes, 1-based);
- relative only — no `/abs`, `C:\`, `~`, `.`/`..`, dot-prefixed segments, or
  `node_modules`;
- source-file extensions only (`js jsx ts tsx mjs cjs mts cts vue svelte
astro mdx`).

A manually authored attribute always wins over the runtime stamp. Invalid
values are ignored (validated in the widget, at the API, and again in the
brief factory), and the picker falls back to the nearest annotated ancestor,
so one stamp on a container covers its children.

## Trust boundary

The attribute lives in the page DOM, so its value is app/submitter-controlled
data. Everything downstream treats it that way: the widget validates before
preview, the API schema gates shape, and the brief factory — the only
producer of agent instructions — re-validates and drops anything invalid.
Agent prompts render the hint as a location to **verify first**, never as an
instruction. A shape-valid but adversarial hint is contained by the existing
controls: triage before code, diff ceiling, no auto-merge, human PR review.
