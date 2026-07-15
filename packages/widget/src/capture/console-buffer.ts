import type { ConsoleEntry } from '@patchback/types';

/**
 * Console-error ring buffer — config consent required: the console wrap is
 * NOT INSTALLED AT ALL unless `capture.console` is enabled (installing the
 * wrap is itself capture behavior, so zero config means zero patching).
 *
 * - Errors only by default; `warn` is opt-in via `levels`. log/info/debug
 *   are unrepresentable (the ConsoleEntry type and the server schema both
 *   enforce `error | warn`).
 * - Scrub-at-insert: secrets never sit in widget memory.
 * - Ring capped at `max` (default 50 — mirrors the server schema), oldest
 *   evicted.
 * - `uninstall()` restores originals by reference-swap ONLY if the wrapper
 *   is still ours; if someone wrapped after us, we leave their chain intact
 *   and just stop recording.
 */

export type ConsoleLevel = ConsoleEntry['level'];

export interface ConsoleBufferOptions {
  levels?: readonly ConsoleLevel[];
  max?: number;
  scrub?: (text: string) => string;
  now?: () => Date;
  /** Injectable targets for tests. */
  console?: Pick<Console, 'error' | 'warn'>;
  window?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

export interface ConsoleBuffer {
  install(): void;
  uninstall(): void;
  readonly installed: boolean;
  entries(): ConsoleEntry[];
  clear(): void;
}

export const CONSOLE_BUFFER_DEFAULT_MAX = 50;
const MAX_MESSAGE_CHARS = 2000;
const MAX_STACK_FRAMES = 5;

export function createConsoleBuffer(
  options: ConsoleBufferOptions = {},
): ConsoleBuffer {
  const levels: readonly ConsoleLevel[] = options.levels ?? ['error'];
  const max = options.max ?? CONSOLE_BUFFER_DEFAULT_MAX;
  const scrub = options.scrub ?? ((text: string): string => text);
  const now = options.now ?? ((): Date => new Date());
  const consoleTarget =
    options.console ?? (globalThis.console as Pick<Console, 'error' | 'warn'>);
  const windowTarget =
    options.window ??
    (typeof window !== 'undefined' ? window : undefined);

  const ring: ConsoleEntry[] = [];
  let recording = false;
  let installedFlag = false;
  const originals = new Map<ConsoleLevel, (...args: unknown[]) => void>();
  const wrappers = new Map<ConsoleLevel, (...args: unknown[]) => void>();

  function push(level: ConsoleLevel, message: string): void {
    if (!recording) {
      return;
    }
    const entry: ConsoleEntry = {
      level,
      message: scrub(message).slice(0, MAX_MESSAGE_CHARS),
      timestamp: now().toISOString(),
    };
    ring.push(entry);
    while (ring.length > max) {
      ring.shift();
    }
  }

  const onError = (event: unknown): void => {
    const e = event as { message?: unknown; error?: unknown };
    const detail =
      e.error !== undefined && e.error !== null
        ? serializeArg(e.error)
        : typeof e.message === 'string'
          ? e.message
          : 'uncaught error';
    push('error', `Uncaught: ${detail}`);
  };

  const onRejection = (event: unknown): void => {
    const e = event as { reason?: unknown };
    push('error', `Unhandled rejection: ${serializeArg(e.reason)}`);
  };

  return {
    get installed(): boolean {
      return installedFlag;
    },

    install(): void {
      if (installedFlag) {
        return; // Idempotent.
      }
      installedFlag = true;
      recording = true;
      for (const level of levels) {
        const original = consoleTarget[level] as (...args: unknown[]) => void;
        originals.set(level, original);
        const wrapper = (...args: unknown[]): void => {
          push(level, args.map(serializeArg).join(' '));
          original.apply(consoleTarget, args);
        };
        wrappers.set(level, wrapper);
        (consoleTarget as Record<ConsoleLevel, unknown>)[level] = wrapper;
      }
      if (levels.includes('error') && windowTarget !== undefined) {
        windowTarget.addEventListener('error', onError as EventListener);
        windowTarget.addEventListener(
          'unhandledrejection',
          onRejection as EventListener,
        );
      }
    },

    uninstall(): void {
      if (!installedFlag) {
        return; // Idempotent.
      }
      installedFlag = false;
      recording = false;
      for (const level of levels) {
        const wrapper = wrappers.get(level);
        const original = originals.get(level);
        if (
          wrapper !== undefined &&
          original !== undefined &&
          (consoleTarget as Record<ConsoleLevel, unknown>)[level] === wrapper
        ) {
          // Still ours — safe to restore.
          (consoleTarget as Record<ConsoleLevel, unknown>)[level] = original;
        }
        // Someone else wrapped after us: leave their chain; our wrapper
        // becomes a pass-through because `recording` is false.
      }
      wrappers.clear();
      originals.clear();
      if (windowTarget !== undefined) {
        windowTarget.removeEventListener('error', onError as EventListener);
        windowTarget.removeEventListener(
          'unhandledrejection',
          onRejection as EventListener,
        );
      }
    },

    entries(): ConsoleEntry[] {
      return ring.map((entry) => ({ ...entry }));
    },

    clear(): void {
      ring.length = 0;
    },
  };
}

function serializeArg(arg: unknown): string {
  if (arg instanceof Error) {
    const frames = (arg.stack ?? '')
      .split('\n')
      .slice(1, 1 + MAX_STACK_FRAMES)
      .join('\n');
    return frames === ''
      ? `${arg.name}: ${arg.message}`
      : `${arg.name}: ${arg.message}\n${frames}`;
  }
  if (typeof arg === 'string') {
    return arg;
  }
  if (
    typeof arg === 'number' ||
    typeof arg === 'boolean' ||
    typeof arg === 'bigint' ||
    arg === null ||
    arg === undefined
  ) {
    return String(arg);
  }
  try {
    const json = JSON.stringify(arg);
    if (typeof json === 'string') {
      return json.slice(0, MAX_MESSAGE_CHARS);
    }
  } catch {
    // Cycles and exotic objects fall through.
  }
  return '[object]';
}
