/**
 * `LocalRepoProbe` — the reference deterministic `RepoProbe` implementation for
 * `patchback dev`, over a real on-disk working copy (`localRepoPath`).
 *
 * Security posture (see the Phase 3 plan §7 and the DECISIONS entry):
 *  - FIXED-STRING matching, IN-PROCESS. Each query is counted with
 *    `String.prototype.indexOf` — never compiled to a regex, never passed to a
 *    shell or `child_process`. There is no argv, glob, or regex surface at all,
 *    so query-injection is eliminated as a category rather than mitigated. A
 *    hostile query like `$(rm -rf /)` is just a literal that matches or doesn't.
 *  - Hard ignore list: `.git`, `node_modules`, `dist`/`build`/`.next`/
 *    `coverage`, and EVERY dot-directory and dotfile (so `.env`/`.env.*` and
 *    secrets are structurally unsearchable — a match count can never even
 *    confirm a secret string's presence).
 *  - Bounded: files scanned, bytes per file, total bytes, and wall-clock time
 *    are all capped; hitting any cap sets `truncated` and stops. A truncated
 *    probe can NEVER be "unambiguous", so a cap can only withhold an up-move.
 *  - Read-only: opens files for reading only; never writes, never executes,
 *    never follows symlinks out of the repo root.
 *  - Returns PATHS + COUNTS ONLY — never file contents or matched lines.
 */
import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

import type { ProbeMatchFile, ProbeResult, RepoProbe } from '@patchback/triage';

/** All constants — no runtime knobs. */
export const PROBE_LIMITS = {
  maxFilesScanned: 4000,
  maxFileBytes: 512 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxMatchesPerFile: 1000,
  timeoutMs: 2000,
} as const;

/** Directories never descended into. Every dot-directory is also excluded. */
const IGNORE_DIRS: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
]);

/** A returned path segment: letters, digits, `_`, `.`, `-`, no leading dot. */
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/** Non-overlapping fixed-string occurrence count. No regex. */
function countOccurrences(haystack: string, needle: string, cap: number): number {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) {
      break;
    }
    count += 1;
    if (count >= cap) {
      break;
    }
    from = at + needle.length;
  }
  return count;
}

/** POSIX repo-root-relative path with a conservative, dotfile-free shape. */
function toSafeRelPath(root: string, absFile: string): string | undefined {
  const rel = path.relative(root, absFile);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return undefined;
  }
  const posix = rel.split(path.sep).join('/');
  for (const segment of posix.split('/')) {
    if (!SEGMENT.test(segment)) {
      return undefined;
    }
  }
  return posix;
}

/**
 * Build a `RepoProbe` rooted at a real working-copy directory. Throws if the
 * directory does not exist — callers should only construct this when
 * `localRepoPath` is a real directory.
 */
export function createLocalRepoProbe(rootDir: string): RepoProbe {
  const root = realpathSync(rootDir);
  const rootStat = statSync(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`repo probe root is not a directory: ${rootDir}`);
  }

  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    async search(queries: readonly string[]): Promise<ProbeResult> {
      const started = Date.now();
      const usable = queries.filter((q) => q.length > 0);
      const perFileCounts = new Map<string, Map<string, number>>();
      const distinct = new Set<string>();
      let totalMatches = 0;
      let filesScanned = 0;
      let totalBytes = 0;
      let truncated = false;

      const timedOut = (): boolean =>
        Date.now() - started > PROBE_LIMITS.timeoutMs;

      const walk = (dir: string): void => {
        if (truncated) {
          return;
        }
        let entries: import('node:fs').Dirent[];
        try {
          entries = readdirSync(dir, { withFileTypes: true });
        } catch {
          return; // unreadable directory — skip, don't fail the probe
        }
        for (const entry of entries) {
          if (truncated) {
            return;
          }
          const name = entry.name;
          // Skip every dotfile / dot-directory and the named ignore dirs.
          if (name.startsWith('.') || IGNORE_DIRS.has(name)) {
            continue;
          }
          const abs = path.join(dir, name);
          // Never follow symlinks (guards escape out of the root).
          let lst;
          try {
            lst = lstatSync(abs);
          } catch {
            continue;
          }
          if (lst.isSymbolicLink()) {
            continue;
          }
          if (lst.isDirectory()) {
            walk(abs);
            continue;
          }
          if (!lst.isFile()) {
            continue;
          }
          if (filesScanned >= PROBE_LIMITS.maxFilesScanned || timedOut()) {
            truncated = true;
            return;
          }
          if (lst.size > PROBE_LIMITS.maxFileBytes) {
            continue; // oversized file: skip (not a "small edit site")
          }
          if (totalBytes + lst.size > PROBE_LIMITS.maxTotalBytes) {
            truncated = true;
            return;
          }
          const relPath = toSafeRelPath(root, abs);
          if (relPath === undefined) {
            continue;
          }
          let content: string;
          try {
            content = readFileSync(abs, 'utf8');
          } catch {
            continue;
          }
          filesScanned += 1;
          totalBytes += lst.size;
          // Binary guard: a NUL byte means this is not source text.
          if (content.includes('\u0000')) {
            continue;
          }
          for (const query of usable) {
            const n = countOccurrences(
              content,
              query,
              PROBE_LIMITS.maxMatchesPerFile,
            );
            if (n <= 0) {
              continue;
            }
            if (n >= PROBE_LIMITS.maxMatchesPerFile) {
              truncated = true;
            }
            let byQuery = perFileCounts.get(query);
            if (byQuery === undefined) {
              byQuery = new Map<string, number>();
              perFileCounts.set(query, byQuery);
            }
            byQuery.set(relPath, n);
            distinct.add(relPath);
            totalMatches += n;
          }
        }
      };

      walk(root);

      const perQuery = usable.map((query) => {
        const byFile = perFileCounts.get(query);
        const files: ProbeMatchFile[] = byFile
          ? [...byFile.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([p, count]) => ({ path: p, count }))
          : [];
        return { query, files };
      });

      return {
        perQuery,
        distinctFiles: [...distinct].sort((a, b) => a.localeCompare(b)),
        totalMatches,
        truncated,
      };
    },
  };
}
