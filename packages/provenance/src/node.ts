/**
 * Node-only helpers shared by the build integrations (Vite plugin, Next
 * helper, babel plugin). Never imported from browser-safe entries.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

import { isValidSourceHint } from '@patchback/types';

/**
 * Nearest ancestor directory (inclusive) containing `.git` — a directory in
 * a normal checkout, a FILE in worktrees/submodules; both count. Returns
 * `undefined` when no repository boundary is found.
 *
 * The agent pipeline clones the REPOSITORY root, so hints must be
 * repo-root-relative (an app-root-relative `src/page.tsx` would not resolve
 * in a monorepo). Overridable everywhere via the `root` option for
 * worktree/submodule/nested-repo layouts.
 */
export function findRepoRoot(startDir: string): string | undefined {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, '.git'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * Build-time relativization for the static (babel) path: absolute
 * `fileName` → validated repo-root-relative path, or `undefined` (fail
 * closed — same contract as the runtime core).
 */
export function relativizeAbsolute(
  fileName: string,
  root: string,
): string | undefined {
  const normalizedFile = fileName.split(sep).join('/');
  const normalizedRoot = resolve(root).split(sep).join('/').replace(/\/+$/, '');
  if (
    normalizedRoot === '' ||
    !normalizedFile.startsWith(`${normalizedRoot}/`)
  ) {
    return undefined;
  }
  const relative = normalizedFile.slice(normalizedRoot.length + 1);
  return isValidSourceHint(`${relative}:1`) ? relative : undefined;
}
