import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type {
  AgentAdapter,
  AgentContext,
  GuardedTaskBrief,
} from '@patchback/agent-core';
import {
  checkoutNewBranch,
  cloneRepository,
  detectAndRunChecks,
  listNewTopLevelDotDirs,
  withScratchDir,
} from '@patchback/agent-core';
import type { FileChange, GitHubClient } from '@patchback/github';
import type { Job } from '@patchback/types';

/**
 * The patch pipeline seam: everything between a guarded brief and an open PR.
 * Injectable so integration tests run a scripted fake; the default
 * implementation wires agent-core (scratch dir, adapter lifecycle,
 * check-runner) to @patchback/github (branch, commit, PR).
 *
 * Trust boundary: `run` accepts ONLY a {@link GuardedTaskBrief} — the branded
 * type constructible solely via `createBriefFromTriagedFeedback`, which
 * enforces eligible tier + patchable classification. A pipeline cannot be
 * invoked with outsider-derived instructions by construction.
 */
export type PatchPipelineResult =
  | { ok: true; branch: string; prNumber: number; prUrl: string }
  | { ok: false; error: string };

export interface PatchPipeline {
  run(brief: GuardedTaskBrief, job: Job): Promise<PatchPipelineResult>;
}

export interface DefaultPipelineOptions {
  adapter: AgentAdapter;
  githubClient: GitHubClient;
  /** Local path or URL `git clone` accepts — the target repo. */
  repoSource: string;
  /** Base branch PRs target. Defaults to the repository's default branch. */
  baseBranch?: string;
  /** Scratch base override for tests. Default `~/.patchback/jobs`. */
  scratchBaseDir?: string;
  /** Sink for operational warnings (e.g. dropped artifacts). Default console.warn. */
  log?: (message: string) => void;
}

/** Working branch name for a job. */
export function patchBranchName(jobId: string): string {
  return `patchback/job-${jobId.replace(/[^A-Za-z0-9._-]/g, '-')}`;
}

/**
 * The default pipeline:
 *
 * scratch dir → clone target repo → new branch → adapter prepare/plan/execute
 * → check-runner (target repo's own lint/typecheck/test) → read changed files
 * → createBranch + commitFiles (the agent leaves the tree dirty; committing is
 * ours) → openPullRequest (linking the issue).
 *
 * Failures return `{ ok: false, error }` with the human-useful message
 * preserved — the worker moves the job to `patch.failed` with it. The scratch
 * dir is ALWAYS deleted (withScratchDir), success or failure.
 */
export function createDefaultPatchPipeline(
  options: DefaultPipelineOptions,
): PatchPipeline {
  const { adapter, githubClient, repoSource, baseBranch, scratchBaseDir } =
    options;
  const log = options.log ?? ((message: string): void => console.warn(message));

  return {
    async run(brief: GuardedTaskBrief, job: Job): Promise<PatchPipelineResult> {
      const branch = patchBranchName(job.id);
      try {
        return await withScratchDir(
          job.id,
          async (dir) => {
            const workDir = path.join(dir, 'repo');
            await cloneRepository(repoSource, workDir);
            await checkoutNewBranch(workDir, branch);

            const ctx: AgentContext = { jobId: job.id, brief, workDir };
            await adapter.prepare(ctx);
            await adapter.plan(ctx);
            const execution = await adapter.execute(ctx);
            if (!execution.success) {
              return {
                ok: false as const,
                error: execution.error ?? 'agent execution failed',
              };
            }
            // Privacy boundary, second layer (the adapter's diff sweep is
            // the first): never commit files under a top-level dot-directory
            // that appeared during the run but is not part of the base
            // commit — those are local tool artifacts (hook logs, plugin
            // caches) that can carry machine-local paths into a public PR.
            const artifactDirs = new Set(await listNewTopLevelDotDirs(workDir));
            const changedFiles = execution.changedFiles.filter((file) => {
              const [top] = file.path.split('/');
              if (top !== undefined && artifactDirs.has(top)) {
                log(
                  `Refusing to commit "${file.path}": "${top}/" is a newly ` +
                    'created top-level dot-directory, not part of the ' +
                    'repository — treating it as a local tool artifact.',
                );
                return false;
              }
              return true;
            });
            if (changedFiles.length === 0) {
              return { ok: false as const, error: 'agent changed no files' };
            }
            const binary = changedFiles.find((file) => file.binary);
            if (binary !== undefined) {
              return {
                ok: false as const,
                error: `agent changed a binary file (${binary.path}); binary changes are not supported in v0.1`,
              };
            }

            const checks = await detectAndRunChecks(
              workDir,
              ctx.conventions?.scripts ?? {},
              ctx.conventions?.packageManager !== undefined
                ? { packageManager: ctx.conventions.packageManager }
                : undefined,
            );
            if (!checks.allPassed) {
              const failed = checks.ran
                .filter((check) => !check.passed)
                .map((check) => `${check.name} (${check.command})`)
                .join(', ');
              return {
                ok: false as const,
                error: `target repo checks failed: ${failed}`,
              };
            }

            const files: FileChange[] = [];
            for (const changed of changedFiles) {
              const absolute = path.join(workDir, changed.path);
              if (await fileExists(absolute)) {
                files.push({
                  path: changed.path,
                  content: await readFile(absolute, 'utf8'),
                });
              } else {
                files.push({ path: changed.path, delete: true });
              }
            }

            const summary = await adapter.summarize(ctx);
            await githubClient.createBranch({
              branch,
              ...(baseBranch !== undefined ? { from: baseBranch } : {}),
            });
            await githubClient.commitFiles({
              branch,
              message: summary.title,
              files,
            });
            const body =
              job.issueNumber !== undefined
                ? `${summary.body}\n\nCloses #${job.issueNumber}`
                : summary.body;
            const pr = await githubClient.openPullRequest({
              title: summary.title,
              head: branch,
              body,
              ...(baseBranch !== undefined ? { base: baseBranch } : {}),
            });
            return {
              ok: true as const,
              branch,
              prNumber: pr.number,
              prUrl: pr.url,
            };
          },
          scratchBaseDir !== undefined
            ? { baseDir: scratchBaseDir }
            : undefined,
        );
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}
