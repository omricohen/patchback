import { spawn } from 'node:child_process';

import type { ChangedFile } from './adapter.js';

/**
 * Minimal git helpers over the system `git` binary, shared by adapters and
 * the local runner. Local plumbing only — remote operations (push, PR) belong
 * to `@patchback/github`.
 */

export class GitCommandError extends Error {
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(args: readonly string[], exitCode: number | null, stderr: string) {
    super(
      `git ${args.join(' ')} failed (exit ${exitCode ?? 'signal'}): ${stderr.trim()}`,
    );
    this.name = 'GitCommandError';
    this.args = args;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/** Run a git command in `cwd`; resolve stdout, reject with GitCommandError. */
export function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', (error) =>
      reject(new GitCommandError(args, null, error.message)),
    );
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new GitCommandError(args, code, stderr));
    });
  });
}

/** Whether `dir` is inside a git work tree. */
export async function isGitWorkTree(dir: string): Promise<boolean> {
  try {
    const out = await runGit(dir, ['rev-parse', '--is-inside-work-tree']);
    return out.trim() === 'true';
  } catch {
    return false;
  }
}

/** Clone `source` (local path or URL) into `dest`. */
export async function cloneRepository(
  source: string,
  dest: string,
): Promise<void> {
  // cwd is irrelevant for clone with absolute dest; use dest's parent-safe '.'
  await runGit(process.cwd(), ['clone', '--quiet', source, dest]);
}

/** Create and check out a new branch in `dir`. */
export async function checkoutNewBranch(
  dir: string,
  branch: string,
): Promise<void> {
  await runGit(dir, ['checkout', '--quiet', '-b', branch]);
}

/** Current branch name in `dir`. */
export async function currentBranch(dir: string): Promise<string> {
  return (await runGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
}

/**
 * Uncommitted changes in `dir` as parsed `git diff --numstat`, including
 * untracked files (via `git add --intent-to-add`). Binary files count as 0
 * lines but are flagged `binary: true`.
 */
export async function diffNumstat(dir: string): Promise<ChangedFile[]> {
  // Make untracked files visible to diff without staging their content.
  await runGit(dir, ['add', '--intent-to-add', '--all']);
  const raw = await runGit(dir, ['diff', '--numstat']);
  const files: ChangedFile[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    const [added, deleted, ...pathParts] = line.split('\t');
    const filePath = pathParts.join('\t');
    if (added === undefined || deleted === undefined || filePath === '') {
      continue;
    }
    const binary = added === '-' || deleted === '-';
    files.push({
      path: filePath,
      additions: binary ? 0 : Number.parseInt(added, 10),
      deletions: binary ? 0 : Number.parseInt(deleted, 10),
      binary,
    });
  }
  return files;
}

/** Total added + deleted lines across a numstat result. */
export function totalChangedLines(files: readonly ChangedFile[]): number {
  return files.reduce((sum, file) => sum + file.additions + file.deletions, 0);
}
