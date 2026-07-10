import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readRepoConventions } from './repo-reader.js';

let repoDir: string;

beforeEach(async () => {
  repoDir = await mkdtemp(path.join(os.tmpdir(), 'patchback-reader-test-'));
});

afterEach(async () => {
  await rm(repoDir, { recursive: true, force: true });
});

describe('readRepoConventions', () => {
  it('reads name, scripts, docs, and detects pnpm from lockfile', async () => {
    await writeFile(
      path.join(repoDir, 'package.json'),
      JSON.stringify({
        name: 'fixture-app',
        scripts: { lint: 'eslint .', test: 'vitest run' },
      }),
    );
    await writeFile(path.join(repoDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
    await writeFile(path.join(repoDir, 'README.md'), '# Fixture app');
    await writeFile(path.join(repoDir, 'CONTRIBUTING.md'), 'Be nice.');
    await writeFile(path.join(repoDir, 'AGENTS.md'), 'Use pnpm.');

    const conventions = await readRepoConventions(repoDir);
    expect(conventions.packageName).toBe('fixture-app');
    expect(conventions.packageManager).toBe('pnpm');
    expect(conventions.scripts).toEqual({ lint: 'eslint .', test: 'vitest run' });
    expect(conventions.docs.readme).toBe('# Fixture app');
    expect(conventions.docs.contributing).toBe('Be nice.');
    expect(conventions.docs.agents).toBe('Use pnpm.');
  });

  it.each([
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
    ['bun.lockb', 'bun'],
  ] as const)('detects %s → %s', async (lockfile, expected) => {
    await writeFile(path.join(repoDir, lockfile), '');
    const conventions = await readRepoConventions(repoDir);
    expect(conventions.packageManager).toBe(expected);
  });

  it('prefers lockfile over the packageManager field', async () => {
    await writeFile(
      path.join(repoDir, 'package.json'),
      JSON.stringify({ packageManager: 'yarn@4.0.0' }),
    );
    await writeFile(path.join(repoDir, 'pnpm-lock.yaml'), '');
    const conventions = await readRepoConventions(repoDir);
    expect(conventions.packageManager).toBe('pnpm');
  });

  it('falls back to the packageManager field, then npm', async () => {
    await writeFile(
      path.join(repoDir, 'package.json'),
      JSON.stringify({ packageManager: 'pnpm@10.0.0' }),
    );
    expect((await readRepoConventions(repoDir)).packageManager).toBe('pnpm');

    await rm(path.join(repoDir, 'package.json'));
    expect((await readRepoConventions(repoDir)).packageManager).toBe('npm');
  });

  it('falls back to CLAUDE.md when AGENTS.md is absent', async () => {
    await writeFile(path.join(repoDir, 'CLAUDE.md'), 'Agent notes.');
    const conventions = await readRepoConventions(repoDir);
    expect(conventions.docs.agents).toBe('Agent notes.');
  });

  it('finds CONTRIBUTING.md under .github/', async () => {
    await mkdir(path.join(repoDir, '.github'));
    await writeFile(
      path.join(repoDir, '.github', 'CONTRIBUTING.md'),
      'PRs welcome.',
    );
    const conventions = await readRepoConventions(repoDir);
    expect(conventions.docs.contributing).toBe('PRs welcome.');
  });

  it('truncates docs at the cap with a marker', async () => {
    await writeFile(path.join(repoDir, 'README.md'), 'x'.repeat(500));
    const conventions = await readRepoConventions(repoDir, { docCharCap: 100 });
    expect(conventions.docs.readme).toContain('truncated by patchback');
    expect(conventions.docs.readme!.length).toBeLessThan(200);
  });

  it('degrades gracefully: empty repo and unparsable package.json', async () => {
    const empty = await readRepoConventions(repoDir);
    expect(empty).toEqual({ packageManager: 'npm', scripts: {}, docs: {} });

    await writeFile(path.join(repoDir, 'package.json'), 'not json{');
    const broken = await readRepoConventions(repoDir);
    expect(broken.scripts).toEqual({});
    expect(broken.packageManager).toBe('npm');
  });

  it('ignores non-string script values', async () => {
    await writeFile(
      path.join(repoDir, 'package.json'),
      JSON.stringify({ scripts: { lint: 'eslint .', weird: 42 } }),
    );
    const conventions = await readRepoConventions(repoDir);
    expect(conventions.scripts).toEqual({ lint: 'eslint .' });
  });
});
