/**
 * Compact deterministic fixed-string probe over the checked-in fixture repo,
 * used ONLY by the retrieval evals. Mirrors the security invariants of the
 * CLI's `LocalRepoProbe` (fixed-string, in-process, dotfile/node_modules
 * ignore, paths + counts only) in the minimal form the plan calls for. The
 * fully-bounded reference implementation and its exhaustive tests live in
 * `packages/cli/src/repo-probe.ts`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import type { ProbeResult, RepoProbe } from '../src/probe.js';

const IGNORE = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage']);
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    count += 1;
    from = at + needle.length;
  }
  return count;
}

function walk(dir: string, root: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || IGNORE.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walk(abs, root, out);
    } else if (entry.isFile()) {
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (rel.split('/').every((seg) => SEGMENT.test(seg))) out.push(abs);
    }
  }
}

export function createFixtureRepoProbe(rootDir: string): RepoProbe {
  const root = path.resolve(rootDir);
  statSync(root); // throws if missing
  return {
    async search(queries: readonly string[]): Promise<ProbeResult> {
      const files: string[] = [];
      walk(root, root, files);
      const distinct = new Set<string>();
      let totalMatches = 0;
      const perQuery = queries.map((query) => {
        const matched: { path: string; count: number }[] = [];
        for (const abs of files) {
          let content: string;
          try {
            content = readFileSync(abs, 'utf8');
          } catch {
            continue;
          }
          if (content.includes('\u0000')) continue;
          const n = countOccurrences(content, query);
          if (n > 0) {
            const rel = path.relative(root, abs).split(path.sep).join('/');
            matched.push({ path: rel, count: n });
            distinct.add(rel);
            totalMatches += n;
          }
        }
        matched.sort((a, b) => a.path.localeCompare(b.path));
        return { query, files: matched };
      });
      return {
        perQuery,
        distinctFiles: [...distinct].sort((a, b) => a.localeCompare(b)),
        totalMatches,
        truncated: false,
      };
    },
  };
}
