import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadDotEnv, parseDotEnv, upsertDotEnv } from './env.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'patchback-env-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('parseDotEnv', () => {
  it('parses assignments, ignores comments/blanks, strips quotes', () => {
    expect(
      parseDotEnv(
        ['# comment', '', 'A=1', 'B="two"', "C='three'", 'not a line'].join(
          '\n',
        ),
      ),
    ).toEqual({ A: '1', B: 'two', C: 'three' });
  });
});

describe('loadDotEnv', () => {
  it('fills gaps but never overrides the real environment', async () => {
    const dir = await makeTempDir();
    await writeFile(path.join(dir, '.env'), 'FROM_FILE=file\nBOTH=file\n');
    const env: NodeJS.ProcessEnv = { BOTH: 'environment' };
    const applied = await loadDotEnv(dir, env);
    expect(env.FROM_FILE).toBe('file');
    expect(env.BOTH).toBe('environment');
    expect(applied).toEqual(['FROM_FILE']);
  });

  it('is a no-op without a .env file', async () => {
    const dir = await makeTempDir();
    const env: NodeJS.ProcessEnv = {};
    expect(await loadDotEnv(dir, env)).toEqual([]);
  });
});

describe('upsertDotEnv', () => {
  it('creates the file chmod 600 with the entries', async () => {
    const dir = await makeTempDir();
    const filePath = await upsertDotEnv(dir, { GITHUB_TOKEN: 'tok' });
    const stats = await stat(filePath);
    expect(stats.mode & 0o777).toBe(0o600);
    expect(await readFile(filePath, 'utf8')).toContain('GITHUB_TOKEN=tok');
  });

  it('replaces existing assignments in place and keeps other lines', async () => {
    const dir = await makeTempDir();
    await writeFile(
      path.join(dir, '.env'),
      '# keep me\nOTHER=untouched\nGITHUB_TOKEN=old\n',
    );
    await upsertDotEnv(dir, { GITHUB_TOKEN: 'new', ANTHROPIC_API_KEY: 'k' });
    const content = await readFile(path.join(dir, '.env'), 'utf8');
    expect(content).toContain('# keep me');
    expect(content).toContain('OTHER=untouched');
    expect(content).toContain('GITHUB_TOKEN=new');
    expect(content).not.toContain('GITHUB_TOKEN=old');
    expect(content).toContain('ANTHROPIC_API_KEY=k');
  });
});
