import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  checkoutNewBranch,
  cloneRepository,
  currentBranch,
  diffNumstat,
  GitCommandError,
  isGitWorkTree,
  listNewTopLevelDotDirs,
  runGit,
  totalChangedLines,
} from './git.js';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'patchback-git-test-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function initRepo(dir: string): Promise<void> {
  await runGit(dir, ['init', '--quiet', '--initial-branch=main']);
  await runGit(dir, ['config', 'user.email', 'test@example.com']);
  await runGit(dir, ['config', 'user.name', 'Patchback Test']);
}

describe('git helpers', () => {
  it('isGitWorkTree distinguishes repos from plain dirs', async () => {
    expect(await isGitWorkTree(workDir)).toBe(false);
    await initRepo(workDir);
    expect(await isGitWorkTree(workDir)).toBe(true);
  });

  it('runGit rejects with a typed error on failure', async () => {
    await expect(runGit(workDir, ['rev-parse', 'HEAD'])).rejects.toThrow(
      GitCommandError,
    );
  });

  it('clone + new branch + numstat round-trip', async () => {
    const sourceDir = path.join(workDir, 'source');
    const cloneDir = path.join(workDir, 'clone');
    await runGit(workDir, [
      'init',
      '--quiet',
      '--initial-branch=main',
      'source',
    ]);
    await runGit(sourceDir, ['config', 'user.email', 'test@example.com']);
    await runGit(sourceDir, ['config', 'user.name', 'Patchback Test']);
    await writeFile(path.join(sourceDir, 'a.txt'), 'one\ntwo\nthree\n');
    await runGit(sourceDir, ['add', '.']);
    await runGit(sourceDir, ['commit', '--quiet', '-m', 'init']);

    await cloneRepository(sourceDir, cloneDir);
    expect(await isGitWorkTree(cloneDir)).toBe(true);

    await checkoutNewBranch(cloneDir, 'patchback/job-1');
    expect(await currentBranch(cloneDir)).toBe('patchback/job-1');

    // Modify a tracked file and add an untracked one.
    await writeFile(path.join(cloneDir, 'a.txt'), 'one\nTWO\nthree\n');
    await writeFile(path.join(cloneDir, 'new.txt'), 'hello\n');

    const files = await diffNumstat(cloneDir);
    const byPath = Object.fromEntries(files.map((file) => [file.path, file]));
    expect(byPath['a.txt']).toMatchObject({
      additions: 1,
      deletions: 1,
      binary: false,
    });
    expect(byPath['new.txt']).toMatchObject({
      additions: 1,
      deletions: 0,
      binary: false,
    });
    expect(totalChangedLines(files)).toBe(3);
  });

  it('diffNumstat flags binary files without counting lines', async () => {
    await initRepo(workDir);
    await writeFile(path.join(workDir, 'keep.txt'), 'text\n');
    await runGit(workDir, ['add', '.']);
    await runGit(workDir, ['commit', '--quiet', '-m', 'init']);
    await writeFile(
      path.join(workDir, 'blob.bin'),
      Buffer.from([0, 1, 2, 0, 255, 0, 3]),
    );

    const files = await diffNumstat(workDir);
    expect(files).toEqual([
      { path: 'blob.bin', additions: 0, deletions: 0, binary: true },
    ]);
    expect(totalChangedLines(files)).toBe(0);
  });

  it('diffNumstat returns [] for a clean tree', async () => {
    await initRepo(workDir);
    await writeFile(path.join(workDir, 'a.txt'), 'x\n');
    await runGit(workDir, ['add', '.']);
    await runGit(workDir, ['commit', '--quiet', '-m', 'init']);
    expect(await diffNumstat(workDir)).toEqual([]);
  });

  describe('dot-directory artifact exclusion (privacy boundary)', () => {
    /** Base commit: one tracked source file + a committed dot-directory. */
    async function initRepoWithBase(dir: string): Promise<void> {
      await initRepo(dir);
      await writeFile(path.join(dir, 'src.txt'), 'one\ntwo\n');
      await mkdir(path.join(dir, '.config'));
      await writeFile(path.join(dir, '.config', 'settings.json'), '{}\n');
      await runGit(dir, ['add', '.']);
      await runGit(dir, ['commit', '--quiet', '-m', 'init']);
    }

    it('listNewTopLevelDotDirs reports only dot-dirs absent from HEAD', async () => {
      await initRepoWithBase(workDir);
      await mkdir(path.join(workDir, '.a5c', 'cache'), { recursive: true });
      await mkdir(path.join(workDir, 'plain-dir'));
      expect(await listNewTopLevelDotDirs(workDir)).toEqual(['.a5c']);
    });

    it('diffNumstat excludes files in newly created top-level dot-dirs and warns', async () => {
      await initRepoWithBase(workDir);
      // The real change…
      await writeFile(path.join(workDir, 'src.txt'), 'one\nTWO\n');
      // …plus hook/plugin artifacts written into the clone during the run.
      await mkdir(path.join(workDir, '.a5c', 'cache'), { recursive: true });
      await writeFile(
        path.join(workDir, '.a5c', 'cache', 'foo.json'),
        '{"cwd":"/Users/someone/private/project"}\n',
      );
      await mkdir(path.join(workDir, '.a5c', 'logs'));
      await writeFile(
        path.join(workDir, '.a5c', 'logs', 'stop-hook.log'),
        'hook ran\n',
      );

      const warnings: string[] = [];
      const files = await diffNumstat(workDir, {
        warn: (message) => warnings.push(message),
      });

      expect(files.map((file) => file.path)).toEqual(['src.txt']);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('.a5c/');
      expect(warnings[0]).toMatch(/will not be committed/i);
    });

    it('keeps changes in dot-dirs that exist in the base commit', async () => {
      await initRepoWithBase(workDir);
      await writeFile(
        path.join(workDir, '.config', 'settings.json'),
        '{"a":1}\n',
      );
      const warnings: string[] = [];
      const files = await diffNumstat(workDir, {
        warn: (message) => warnings.push(message),
      });
      expect(files.map((file) => file.path)).toEqual(['.config/settings.json']);
      expect(warnings).toEqual([]);
    });

    it('keeps new top-level dot FILES (the rule targets directories)', async () => {
      await initRepoWithBase(workDir);
      await writeFile(path.join(workDir, '.nvmrc'), '20\n');
      const warnings: string[] = [];
      const files = await diffNumstat(workDir, {
        warn: (message) => warnings.push(message),
      });
      expect(files.map((file) => file.path)).toEqual(['.nvmrc']);
      expect(warnings).toEqual([]);
    });

    it('stays excluded on repeated sweeps of the same tree', async () => {
      await initRepoWithBase(workDir);
      await writeFile(path.join(workDir, 'src.txt'), 'one\nTWO\n');
      await mkdir(path.join(workDir, '.a5c'));
      await writeFile(path.join(workDir, '.a5c', 'state.json'), '{}\n');
      const warn = (): void => {};
      const first = await diffNumstat(workDir, { warn });
      const second = await diffNumstat(workDir, { warn });
      expect(first.map((file) => file.path)).toEqual(['src.txt']);
      expect(second.map((file) => file.path)).toEqual(['src.txt']);
    });
  });
});
