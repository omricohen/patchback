import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createScratchDir,
  defaultScratchBaseDir,
  isSafeJobId,
  removeScratchDir,
  scratchDirPath,
  withScratchDir,
} from './scratch-dir.js';

let baseDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(path.join(os.tmpdir(), 'patchback-scratch-test-'));
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe('defaultScratchBaseDir', () => {
  it('is ~/.patchback/jobs', () => {
    expect(defaultScratchBaseDir()).toBe(
      path.join(os.homedir(), '.patchback', 'jobs'),
    );
  });
});

describe('isSafeJobId / scratchDirPath', () => {
  it('accepts typical ids', () => {
    expect(isSafeJobId('job-123')).toBe(true);
    expect(isSafeJobId('a1B2.c3_d4')).toBe(true);
  });

  it.each(['', '..', '../evil', 'a/b', 'a\\b', '.hidden', 'a..b/../c'])(
    'rejects unsafe id %j',
    (id) => {
      expect(isSafeJobId(id)).toBe(false);
      expect(() => scratchDirPath(id, { baseDir })).toThrow(/unsafe job id/i);
    },
  );

  it('joins base dir and id', () => {
    expect(scratchDirPath('job-1', { baseDir })).toBe(
      path.join(baseDir, 'job-1'),
    );
  });
});

describe('scratch dir lifecycle', () => {
  it('creates and removes the dir', async () => {
    const dir = await createScratchDir('job-1', { baseDir });
    expect(await exists(dir)).toBe(true);
    await writeFile(path.join(dir, 'file.txt'), 'contents');
    await removeScratchDir('job-1', { baseDir });
    expect(await exists(dir)).toBe(false);
  });

  it('removeScratchDir is idempotent', async () => {
    await expect(
      removeScratchDir('never-created', { baseDir }),
    ).resolves.toBeUndefined();
  });

  it('withScratchDir cleans up on success and returns the result', async () => {
    let seenDir = '';
    const result = await withScratchDir(
      'job-ok',
      async (dir) => {
        seenDir = dir;
        await writeFile(path.join(dir, 'work.txt'), 'x');
        return 42;
      },
      { baseDir },
    );
    expect(result).toBe(42);
    expect(seenDir).toBe(path.join(baseDir, 'job-ok'));
    expect(await exists(seenDir)).toBe(false);
  });

  it('withScratchDir cleans up even when the job throws', async () => {
    const dir = scratchDirPath('job-fail', { baseDir });
    await expect(
      withScratchDir(
        'job-fail',
        async (d) => {
          await writeFile(path.join(d, 'partial.txt'), 'x');
          throw new Error('agent exploded');
        },
        { baseDir },
      ),
    ).rejects.toThrow('agent exploded');
    expect(await exists(dir)).toBe(false);
  });
});
