import { spawn } from 'node:child_process';

/**
 * Shared child-process runner used by the check-runner and by adapters that
 * spawn a CLI. Handles the messy parts once: process-group timeouts (a
 * SIGKILL to the group so grandchildren die too), stdin input, and settling
 * even when a surviving grandchild holds the stdio pipes open.
 */

export interface RunProcessOptions {
  cwd?: string;
  /** Kill the whole process tree after this long. Default 10 minutes. */
  timeoutMs?: number;
  /** Extra environment merged over process.env (see `inheritEnv`). */
  env?: Record<string, string>;
  /**
   * When false, the child receives ONLY `env` — nothing is inherited from
   * process.env. Used by adapters that must isolate a spawned CLI from the
   * caller's configuration. Default true (merge `env` over process.env).
   */
  inheritEnv?: boolean;
  /** Text written to the child's stdin (then closed). */
  input?: string;
}

export interface ProcessOutcome {
  /** null when killed by signal or when the process failed to spawn. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** stdout and stderr interleaved in arrival order. */
  combined: string;
  timedOut: boolean;
  /** Set when the process could not be spawned at all. */
  spawnError?: string;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/** Run a command to completion. Never rejects — errors land in the outcome. */
export function runProcess(
  command: string,
  args: string[],
  options?: RunProcessOptions,
): Promise<ProcessOutcome> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve) => {
    const posix = process.platform !== 'win32';
    // detached puts the command and its grandchildren in their own process
    // group so a timeout kill takes the whole tree down, not just the parent.
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env:
        options?.inheritEnv === false
          ? { ...options.env }
          : { ...process.env, ...options?.env },
      stdio: [options?.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      shell: !posix,
      detached: posix,
    });

    let stdout = '';
    let stderr = '';
    let combined = '';
    let timedOut = false;
    let settled = false;

    const settle = (outcome: ProcessOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const outcome = (
      exitCode: number | null,
      spawnError?: string,
    ): ProcessOutcome => {
      const base: ProcessOutcome = {
        exitCode,
        stdout,
        stderr,
        combined,
        timedOut,
      };
      return spawnError === undefined ? base : { ...base, spawnError };
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

    if (options?.input !== undefined && child.stdin !== null) {
      child.stdin.on('error', () => {
        // EPIPE when the child exits without reading stdin — not fatal.
      });
      child.stdin.write(options.input);
      child.stdin.end();
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      combined += text;
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      combined += text;
    });

    child.on('error', (error) => settle(outcome(null, error.message)));
    // 'close' waits for stdio to drain; a surviving grandchild can hold the
    // pipes open, so settle shortly after 'exit' if 'close' never arrives.
    child.on('close', (code) => settle(outcome(code)));
    child.on('exit', (code) => {
      const grace = setTimeout(() => settle(outcome(code)), 500);
      grace.unref();
    });
  });
}
