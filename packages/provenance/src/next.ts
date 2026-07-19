/**
 * Next.js integration for `@patchback/provenance`.
 *
 * Two pieces (both documented in the README):
 * 1. `jsxImportSource: '@patchback/provenance'` in the app's tsconfig
 *    `compilerOptions` — Next's SWC reads it (the same mechanism Emotion
 *    uses), which keeps SWC enabled. The dev transform then imports our
 *    `jsx-dev-runtime` wrapper.
 * 2. `withPatchbackProvenance(nextConfig)` — injects the discovered repo
 *    root via `nextConfig.env` (build-time inlining, works under both
 *    webpack and Turbopack dev) so the runtime can relativize absolute
 *    fileNames. DEV PHASE ONLY: production builds never embed the machine
 *    path (production stamping is the babel plugin's job, and Turbopack
 *    already emits `[project]/`-relative names that need no root).
 */
import { findRepoRoot } from './node.js';

type NextConfigLike = Record<string, unknown> & {
  env?: Record<string, string>;
};

type NextConfigInput =
  | NextConfigLike
  | ((
      phase: string,
      context: unknown,
    ) => NextConfigLike | Promise<NextConfigLike>);

export interface WithPatchbackProvenanceOptions {
  /** Repo root override (worktrees, submodules, nested repos). */
  root?: string;
}

/** Next's development-server phase constant (avoids a hard `next` import). */
const PHASE_DEVELOPMENT_SERVER = 'phase-development-server';

export function withPatchbackProvenance(
  nextConfig: NextConfigInput = {},
  options: WithPatchbackProvenanceOptions = {},
): (phase: string, context: unknown) => Promise<NextConfigLike> {
  return async (phase, context) => {
    const resolved =
      typeof nextConfig === 'function'
        ? await nextConfig(phase, context)
        : nextConfig;
    if (phase !== PHASE_DEVELOPMENT_SERVER) {
      return resolved;
    }
    const root = options.root ?? findRepoRoot(process.cwd()) ?? process.cwd();
    return {
      ...resolved,
      env: {
        ...(resolved.env ?? {}),
        PATCHBACK_PROVENANCE_ROOT: root,
      },
    };
  };
}
