import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createLocalRepoProbe, PROBE_LIMITS } from './repo-probe.js';

const tempDirs: string[] = [];

async function makeRepo(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'patchback-probe-'));
  tempDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('createLocalRepoProbe — fixed-string matching', () => {
  it('counts literal occurrences and reports paths + counts only', async () => {
    const dir = await makeRepo({
      'src/Header.tsx': 'const label = "Ammount Due";\n// Ammount Due again\n',
      'src/Other.tsx': 'export const x = 1;\n',
    });
    const probe = createLocalRepoProbe(dir);
    const result = await probe.search(['Ammount Due']);

    expect(result.distinctFiles).toEqual(['src/Header.tsx']);
    expect(result.totalMatches).toBe(2);
    expect(result.truncated).toBe(false);
    const [entry] = result.perQuery;
    expect(entry?.files).toEqual([{ path: 'src/Header.tsx', count: 2 }]);
    // No file contents anywhere in the result.
    expect(JSON.stringify(result)).not.toContain('const label');
  });

  it('reports multiple distinct files (ambiguous evidence)', async () => {
    const dir = await makeRepo({
      'src/a.ts': 'Save Changes\n',
      'src/b.ts': 'Save Changes\n',
    });
    const probe = createLocalRepoProbe(dir);
    const result = await probe.search(['Save Changes']);
    expect([...result.distinctFiles].sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(result.totalMatches).toBe(2);
  });

  it('treats shell-metacharacter queries as literals (never executed)', async () => {
    const dir = await makeRepo({
      'src/danger.ts': 'const s = "$(rm -rf /)"; // a; cat /etc/passwd\n',
      'sentinel.ts': 'still here\n',
    });
    const probe = createLocalRepoProbe(dir);
    const result = await probe.search(['$(rm -rf /)', 'a; cat /etc/passwd']);
    // Both are matched as plain strings; the repo is intact.
    expect(result.totalMatches).toBeGreaterThanOrEqual(2);
    const sentinel = createLocalRepoProbe(dir);
    const check = await sentinel.search(['still here']);
    expect(check.totalMatches).toBe(1);
  });
});

describe('createLocalRepoProbe — ignore list (secrets unsearchable)', () => {
  it('never scans .env, .git, node_modules, or any dotfile', async () => {
    const dir = await makeRepo({
      '.env': 'SECRET_TOKEN=needle-secret\n',
      '.secretfile': 'needle-secret\n',
      '.git/config': 'needle-secret\n',
      'node_modules/pkg/index.js': 'needle-secret\n',
      'dist/bundle.js': 'needle-secret\n',
      'src/app.ts': '// clean\n',
    });
    const probe = createLocalRepoProbe(dir);
    const result = await probe.search(['needle-secret']);
    expect(result.totalMatches).toBe(0);
    expect(result.distinctFiles).toEqual([]);
  });
});

describe('createLocalRepoProbe — symlink escape refusal', () => {
  it('does not follow symlinks out of the root', async () => {
    const outside = await makeRepo({ 'secret.ts': 'needle-outside\n' });
    const dir = await makeRepo({ 'src/app.ts': '// clean\n' });
    await symlink(
      path.join(outside, 'secret.ts'),
      path.join(dir, 'src', 'link.ts'),
    );
    const probe = createLocalRepoProbe(dir);
    const result = await probe.search(['needle-outside']);
    expect(result.totalMatches).toBe(0);
  });
});

describe('createLocalRepoProbe — caps set truncated', () => {
  it('skips oversized files and does not match inside them', async () => {
    const big = 'x'.repeat(PROBE_LIMITS.maxFileBytes + 10) + '\nneedle\n';
    const dir = await makeRepo({
      'src/big.ts': big,
      'src/small.ts': 'needle\n',
    });
    const probe = createLocalRepoProbe(dir);
    const result = await probe.search(['needle']);
    // Only the small file is scanned.
    expect(result.distinctFiles).toEqual(['src/small.ts']);
  });

  it('binary files with NUL bytes are skipped', async () => {
    const dir = await makeRepo({
      'src/bin.ts': `needle${String.fromCharCode(0)}needle\n`,
      'src/text.ts': 'needle\n',
    });
    const probe = createLocalRepoProbe(dir);
    const result = await probe.search(['needle']);
    expect(result.distinctFiles).toEqual(['src/text.ts']);
  });
});
