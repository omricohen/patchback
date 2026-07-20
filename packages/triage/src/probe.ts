/**
 * The `RepoProbe` seam — a read-only, deterministic retrieval probe over a
 * repo working copy, used by the OPTIONAL triage stage 2.
 *
 * This file is the CONSUMER's contract only. Like `ModelCaller`, it imports no
 * `node:fs` and no vendor code — `@patchback/triage` core stays IO-free and
 * vendor-neutral. Concrete implementations live in the packages that own a
 * filesystem path (the CLI's `LocalRepoProbe`, the eval harness's fixture-repo
 * probe). Stage 2 is enabled purely by the PRESENCE of an injected `RepoProbe`;
 * where no working copy exists (the hosted API worker) the probe is absent and
 * stage 2 is dead code, fail-safe by construction.
 *
 * Security contract every implementation MUST honour (see probe.test partners
 * in the CLI and the plan §7/§8):
 *  - Fixed-string (literal) matching ONLY — a query is never interpreted as a
 *    regex, glob, or shell argument. No `child_process` shell, no argv
 *    interpolation.
 *  - Respect a hard ignore list (`.git`, `node_modules`, `.env*`, dotfiles).
 *  - Be time-, file-, and byte-bounded; set `truncated` on any cap.
 *  - Return PATHS + integer COUNTS ONLY — never file contents, never matched
 *    lines or snippets. This makes the stage-2 evidence structurally incapable
 *    of carrying attacker-controlled prose.
 */

/** A read-only, deterministic retrieval probe over a repo working copy. */
export interface RepoProbe {
  /**
   * Fixed-string search for each query. Deterministic: the same working copy
   * and the same queries always produce the same result.
   */
  search(queries: readonly string[]): Promise<ProbeResult>;
}

/** One file that matched a query, as a path + a match count. Never contents. */
export interface ProbeMatchFile {
  /** Repo-root-relative POSIX path. Shape-constrained by the implementation. */
  path: string;
  /** Number of fixed-string matches for the associated query in this file. */
  count: number;
}

/** The probe's result: paths + counts + the aggregate signals reconcile uses. */
export interface ProbeResult {
  /** Per-query hits: each query maps to the files it matched (paths + counts). */
  perQuery: readonly {
    query: string;
    files: readonly ProbeMatchFile[];
  }[];
  /** Distinct files matched across ALL queries. Drives the unambiguity rule. */
  distinctFiles: readonly string[];
  /** Total matches across all queries/files. Drives the unambiguity rule. */
  totalMatches: number;
  /** True if the probe hit any cap (files, matches, bytes, time) and stopped. */
  truncated: boolean;
}
