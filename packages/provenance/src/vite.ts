/**
 * Vite integration for `@patchback/provenance`.
 *
 * Dev (`vite serve`):
 * - Sets `esbuild.jsxImportSource` to this package so the dev transform
 *   imports our `jsx-dev-runtime` wrapper (mechanism (c) — the runtime
 *   stamps host elements from jsxDEV's `source` argument).
 *   NOTE: `@vitejs/plugin-react` owns its own JSX pipeline — pass
 *   `react({ jsxImportSource: '@patchback/provenance' })` alongside this
 *   plugin (documented in the README).
 * - Injects an inline script that publishes the discovered REPO root
 *   (nearest `.git` ancestor, `root` option overrides) so the runtime can
 *   relativize the absolute fileNames the transform emits. Dev-only: a
 *   production page never carries the machine path.
 *
 * Build (`vite build`): inert by default — production JSX uses
 * `jsx-runtime`, which carries no source info (structural stripping). With
 * `production: 'annotate'` (internal apps opt-in), the babel plugin
 * statically injects attributes instead.
 */
import type { Plugin } from 'vite';

import { findRepoRoot } from './node.js';
import { PROVENANCE_ROOT_GLOBAL } from './core.js';
import type { ProvenanceBabelOptions } from './babel.js';

export interface PatchbackProvenanceViteOptions {
  /** Repo root override (worktrees, submodules, nested repos). */
  root?: string;
  /**
   * Production posture. Default `false`: stripped (structurally). Set
   * `'annotate'` to stamp production builds via the static babel plugin —
   * an informed opt-in for INTERNAL apps (it discloses repo-relative file
   * structure to anyone who can view source).
   */
  production?: false | 'annotate';
  /** Which host elements the production annotator stamps. */
  elements?: 'all' | 'interactive';
}

const JSX_FILE = /\.(jsx|tsx|js|mjs|cjs)$/;

export function patchbackProvenance(
  options: PatchbackProvenanceViteOptions = {},
): Plugin {
  let repoRoot: string | undefined;
  let serve = false;
  const annotateProd = options.production === 'annotate';
  return {
    name: 'patchback-provenance',
    enforce: 'pre',
    config(config, env) {
      serve = env.command === 'serve';
      const projectRoot = config.root ?? process.cwd();
      repoRoot = options.root ?? findRepoRoot(projectRoot) ?? projectRoot;
      if (!serve) {
        return {};
      }
      return {
        esbuild: { jsxImportSource: '@patchback/provenance' },
      };
    },
    transformIndexHtml() {
      if (!serve || repoRoot === undefined) {
        return undefined;
      }
      return [
        {
          tag: 'script',
          children: `globalThis.${PROVENANCE_ROOT_GLOBAL} = ${JSON.stringify(repoRoot)};`,
          injectTo: 'head-prepend',
        },
      ];
    },
    async transform(code, id) {
      if (serve || !annotateProd) {
        return null;
      }
      const cleanId = id.split('?')[0] ?? '';
      if (!JSX_FILE.test(cleanId) || cleanId.includes('/node_modules/')) {
        return null;
      }
      return annotateWithBabel(code, cleanId, {
        ...(repoRoot !== undefined ? { root: repoRoot } : {}),
        ...(options.elements !== undefined
          ? { elements: options.elements }
          : {}),
      });
    },
  };
}

async function annotateWithBabel(
  code: string,
  id: string,
  pluginOptions: ProvenanceBabelOptions,
): Promise<{
  code: string;
  map: import('@babel/core').BabelFileResult['map'];
} | null> {
  const [{ transformAsync }, { default: provenancePlugin }] = await Promise.all(
    [import('@babel/core'), import('./babel.js')],
  );
  const parserPlugins: Array<'jsx' | 'typescript'> = id.endsWith('.tsx')
    ? ['jsx', 'typescript']
    : ['jsx'];
  const result = await transformAsync(code, {
    filename: id,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: parserPlugins },
    plugins: [[provenancePlugin, pluginOptions]],
    sourceMaps: true,
  });
  if (result?.code == null) {
    return null;
  }
  return { code: result.code, map: result.map };
}
