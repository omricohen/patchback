import { describe, expect, it } from 'vitest';

import { scrubText } from '../masking/scrub.js';
import { createConsoleBuffer } from './console-buffer.js';

function fakeConsole(): {
  target: Pick<Console, 'error' | 'warn'>;
  calls: { level: string; args: unknown[] }[];
} {
  const calls: { level: string; args: unknown[] }[] = [];
  return {
    target: {
      error: (...args: unknown[]) => calls.push({ level: 'error', args }),
      warn: (...args: unknown[]) => calls.push({ level: 'warn', args }),
    },
    calls,
  };
}

function fakeWindow(): {
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  listeners: Map<string, Set<EventListener>>;
  emit: (type: string, event: unknown) => void;
} {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    target: {
      addEventListener: ((type: string, fn: EventListener) => {
        const set = listeners.get(type) ?? new Set();
        set.add(fn);
        listeners.set(type, set);
      }) as Window['addEventListener'],
      removeEventListener: ((type: string, fn: EventListener) => {
        listeners.get(type)?.delete(fn);
      }) as Window['removeEventListener'],
    },
    listeners,
    emit(type, event) {
      for (const fn of listeners.get(type) ?? []) {
        fn(event as Event);
      }
    },
  };
}

describe('console ring buffer', () => {
  it('records errors and calls the original through', () => {
    const { target, calls } = fakeConsole();
    const buffer = createConsoleBuffer({
      console: target,
      window: fakeWindow().target,
    });
    buffer.install();
    target.error('boom', 42);
    expect(buffer.entries()).toHaveLength(1);
    expect(buffer.entries()[0]).toMatchObject({
      level: 'error',
      message: 'boom 42',
    });
    expect(calls).toEqual([{ level: 'error', args: ['boom', 42] }]);
  });

  it('captures warn only when opted in via levels', () => {
    const { target } = fakeConsole();
    const errorsOnly = createConsoleBuffer({
      console: target,
      window: fakeWindow().target,
    });
    errorsOnly.install();
    target.warn('just a warning');
    expect(errorsOnly.entries()).toHaveLength(0);
    errorsOnly.uninstall();

    const both = createConsoleBuffer({
      levels: ['error', 'warn'],
      console: target,
      window: fakeWindow().target,
    });
    both.install();
    target.warn('now captured');
    expect(both.entries()).toHaveLength(1);
    expect(both.entries()[0]?.level).toBe('warn');
  });

  it('evicts oldest entries at max (ring semantics)', () => {
    const { target } = fakeConsole();
    const buffer = createConsoleBuffer({
      max: 3,
      console: target,
      window: fakeWindow().target,
    });
    buffer.install();
    for (let i = 1; i <= 5; i += 1) {
      target.error(`e${i}`);
    }
    expect(buffer.entries().map((e) => e.message)).toEqual(['e3', 'e4', 'e5']);
  });

  it('scrubs at insert time — secrets never sit in the ring', () => {
    const { target } = fakeConsole();
    const buffer = createConsoleBuffer({
      scrub: scrubText,
      console: target,
      window: fakeWindow().target,
    });
    buffer.install();
    target.error(
      'auth failed for user@example.com with sk-000000000000000000000000test',
    );
    const message = buffer.entries()[0]?.message ?? '';
    expect(message).toContain('[email]');
    expect(message).toContain('[redacted-key]');
    expect(message).not.toContain('user@example.com');
    expect(message).not.toContain('sk-0000');
  });

  it('serializes Errors with capped stack frames and survives cycles', () => {
    const { target } = fakeConsole();
    const buffer = createConsoleBuffer({
      console: target,
      window: fakeWindow().target,
    });
    buffer.install();
    target.error(new TypeError('bad'));
    expect(buffer.entries()[0]?.message).toContain('TypeError: bad');

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    target.error(cyclic);
    expect(buffer.entries()[1]?.message).toBe('[object]');
  });

  it('captures window error and unhandledrejection events', () => {
    const { target } = fakeConsole();
    const win = fakeWindow();
    const buffer = createConsoleBuffer({ console: target, window: win.target });
    buffer.install();
    win.emit('error', { message: 'script blew up' });
    win.emit('unhandledrejection', { reason: new Error('nope') });
    const messages = buffer.entries().map((e) => e.message);
    expect(messages[0]).toContain('script blew up');
    expect(messages[1]).toContain('Unhandled rejection');
    expect(messages[1]).toContain('nope');
  });

  it('install/uninstall are idempotent and restore the original by reference', () => {
    const { target } = fakeConsole();
    const win = fakeWindow();
    const original = target.error;
    const buffer = createConsoleBuffer({ console: target, window: win.target });
    buffer.install();
    buffer.install();
    expect(target.error).not.toBe(original);
    buffer.uninstall();
    buffer.uninstall();
    expect(target.error).toBe(original);
    expect(win.listeners.get('error')?.size ?? 0).toBe(0);
    // After uninstall, nothing records.
    target.error('late');
    expect(buffer.entries()).toHaveLength(0);
  });

  it('tolerates someone else wrapping after us: leaves their chain, stops recording', () => {
    const { target } = fakeConsole();
    const buffer = createConsoleBuffer({
      console: target,
      window: fakeWindow().target,
    });
    buffer.install();
    const ourWrapper = target.error;
    // A third-party wraps on top of ours.
    const theirs = (...args: unknown[]): void => ourWrapper(...args);
    target.error = theirs;
    buffer.uninstall();
    // Their wrapper stays; ours inside is now a recording no-op.
    expect(target.error).toBe(theirs);
    target.error('after uninstall');
    expect(buffer.entries()).toHaveLength(0);
  });
});
