import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Scratch-dir lifecycle for patch jobs.
 *
 * Each job gets an isolated directory under `~/.patchback/jobs/<id>` where the
 * target repo is cloned and the agent works. The directory is deleted after
 * job completion OR failure — agents run against user repos and may write
 * anything, so nothing must outlive the job. `withScratchDir` is the intended
 * entry point: cleanup lives in a `finally`, so it is guaranteed even when the
 * job throws.
 */

/** Default base: `~/.patchback/jobs`. */
export function defaultScratchBaseDir(): string {
  return path.join(os.homedir(), '.patchback', 'jobs');
}

export interface ScratchDirOptions {
  /** Override the base directory (used by tests). Default `~/.patchback/jobs`. */
  baseDir?: string;
}

/**
 * Job ids become directory names, so they must be a single safe path segment.
 * Rejects traversal (`..`), separators, and anything outside [A-Za-z0-9._-].
 */
export function isSafeJobId(jobId: string): boolean {
  return (
    jobId.length > 0 &&
    jobId.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(jobId) &&
    !jobId.includes('..')
  );
}

/** Absolute scratch path for a job id. Throws on unsafe ids. */
export function scratchDirPath(
  jobId: string,
  options?: ScratchDirOptions,
): string {
  if (!isSafeJobId(jobId)) {
    throw new Error(
      `Unsafe job id for scratch dir: ${JSON.stringify(jobId)}. ` +
        'Job ids must match [A-Za-z0-9][A-Za-z0-9._-]* and contain no "..".',
    );
  }
  return path.join(options?.baseDir ?? defaultScratchBaseDir(), jobId);
}

/** Create (recursively) and return the scratch dir for a job. */
export async function createScratchDir(
  jobId: string,
  options?: ScratchDirOptions,
): Promise<string> {
  const dir = scratchDirPath(jobId, options);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Remove a scratch dir and everything in it. Idempotent. */
export async function removeScratchDir(
  jobId: string,
  options?: ScratchDirOptions,
): Promise<void> {
  const dir = scratchDirPath(jobId, options);
  await rm(dir, { recursive: true, force: true, maxRetries: 3 });
}

/**
 * Create the scratch dir, run `fn` with its path, and ALWAYS delete it
 * afterwards — success, failure, or throw. This is the only sanctioned way to
 * run a job in a scratch dir.
 */
export async function withScratchDir<T>(
  jobId: string,
  fn: (dir: string) => Promise<T>,
  options?: ScratchDirOptions,
): Promise<T> {
  const dir = await createScratchDir(jobId, options);
  try {
    return await fn(dir);
  } finally {
    await removeScratchDir(jobId, options);
  }
}
