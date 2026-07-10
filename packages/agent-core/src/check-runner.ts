import { spawn } from 'node:child_process';

import type { PackageManager } from './repo-reader.js';

/**
 * Check-runner: detect the target repo's lint / typecheck / test scripts and
 * run them via the repo's own package manager, returning structured pass/fail
 * with output tails for the PR body and job logs.
 */

export const CHECK_NAMES = ['lint', 'typecheck', 'test'] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

/** Script keys accepted for each check, in priority order. */
const SCRIPT_ALIASES: Readonly<Record<CheckName, readonly string[]>> = {
  lint: ['lint'],
  typecheck: ['typecheck', 'type-check', 'tsc'],
  test: ['test'],
};

/** npm's scaffold placeholder — not a real test script. */
const NPM_TEST_PLACEHOLDER = /echo\s+.*no test specified.*exit 1/i;

export interface DetectedCheck {
  name: CheckName;
  /** The package.json script key to invoke (e.g. `type-check`). */
  scriptKey: string;
  /** The script body, for logs. */
  script: string;
}

/**
 * Detect runnable checks from a repo's `scripts` map. Order is fixed:
 * lint → typecheck → test (cheapest feedback first).
 */
export function detectChecks(
  scripts: Record<string, string>,
): DetectedCheck[] {
  const detected: DetectedCheck[] = [];
  for (const name of CHECK_NAMES) {
    for (const key of SCRIPT_ALIASES[name]) {
      const script = scripts[key];
      if (script === undefined || script.trim() === '') continue;
      if (name === 'test' && NPM_TEST_PLACEHOLDER.test(script)) continue;
      detected.push({ name, scriptKey: key, script });
      break;
    }
  }
  return detected;
}

export interface CheckResult {
  name: CheckName;
  /** Full command that was run, e.g. `pnpm run lint`. */
  command: string;
  passed: boolean;
  /** Process exit code; null when killed (e.g. timeout). */
  exitCode: number | null;
  /** Tail of combined stdout+stderr, capped. */
  outputTail: string;
  durationMs: number;
  /** Set when the process could not run or timed out. */
  error?: string;
}

export interface ChecksReport {
  ran: CheckResult[];
  /** Checks with no matching script in the target repo. */
  skipped: CheckName[];
  /** True when every check that ran passed (vacuously true if none ran). */
  allPassed: boolean;
}

export interface RunChecksOptions {
  /** Package manager to run scripts with. Default npm. */
  packageManager?: PackageManager;
  /** Per-check timeout. Default 5 minutes. */
  timeoutMs?: number;
  /** Max characters of combined output kept per check. Default 4000. */
  outputTailChars?: number;
  /** Extra environment for the child processes. */
  env?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_TAIL_CHARS = 4000;

function tail(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return `… [output truncated]\n${text.slice(-cap)}`;
}

interface SpawnOutcome {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  spawnError?: string;
}

function runScript(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  env?: Record<string, string>,
): Promise<SpawnOutcome> {
  return new Promise((resolve) => {
    const posix = process.platform !== 'win32';
    // detached puts the script and its grandchildren in their own process
    // group so a timeout kill takes the whole tree down, not just the PM.
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: !posix,
      detached: posix,
    });

    let output = '';
    let timedOut = false;
    let settled = false;
    const settle = (outcome: SpawnOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    const killTree = () => {
      try {
        if (posix && child.pid !== undefined) {
          process.kill(-child.pid, 'SIGKILL');
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        // Already gone.
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));

    child.on('error', (error) =>
      settle({ exitCode: null, output, timedOut, spawnError: error.message }),
    );
    // 'close' waits for stdio to drain; a surviving grandchild can hold the
    // pipes open, so settle shortly after 'exit' if 'close' never arrives.
    child.on('close', (code) => settle({ exitCode: code, output, timedOut }));
    child.on('exit', (code) => {
      const grace = setTimeout(
        () => settle({ exitCode: code, output, timedOut }),
        500,
      );
      grace.unref();
    });
  });
}

/**
 * Run the given checks (from {@link detectChecks}) in `repoDir` via the
 * detected package manager. Never throws for failing checks — failure is data.
 */
export async function runChecks(
  repoDir: string,
  checks: DetectedCheck[],
  options?: RunChecksOptions,
): Promise<ChecksReport> {
  const packageManager = options?.packageManager ?? 'npm';
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tailChars = options?.outputTailChars ?? DEFAULT_TAIL_CHARS;

  const ran: CheckResult[] = [];
  const detectedNames = new Set(checks.map((check) => check.name));
  const skipped = CHECK_NAMES.filter((name) => !detectedNames.has(name));

  for (const check of checks) {
    const args = ['run', check.scriptKey];
    const command = `${packageManager} ${args.join(' ')}`;
    const startedAt = Date.now();
    const outcome = await runScript(
      packageManager,
      args,
      repoDir,
      timeoutMs,
      options?.env,
    );
    const durationMs = Date.now() - startedAt;

    const result: CheckResult = {
      name: check.name,
      command,
      passed: !outcome.timedOut && !outcome.spawnError && outcome.exitCode === 0,
      exitCode: outcome.exitCode,
      outputTail: tail(outcome.output, tailChars),
      durationMs,
    };
    if (outcome.timedOut) {
      result.error = `Timed out after ${timeoutMs}ms`;
    } else if (outcome.spawnError) {
      result.error = `Failed to run ${command}: ${outcome.spawnError}`;
    }
    ran.push(result);
  }

  return {
    ran,
    skipped,
    allPassed: ran.every((result) => result.passed),
  };
}

/**
 * Convenience: detect checks from conventions' scripts, then run them.
 */
export async function detectAndRunChecks(
  repoDir: string,
  scripts: Record<string, string>,
  options?: RunChecksOptions,
): Promise<ChecksReport> {
  return runChecks(repoDir, detectChecks(scripts), options);
}
