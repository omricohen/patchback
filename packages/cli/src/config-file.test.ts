import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CONFIG_FILE_NAME,
  loadConfigFile,
  parseRepoRef,
  renderConfigFile,
  validatePatchbackConfig,
  writeConfigFile,
} from './config-file.js';
import { CliError } from './errors.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'patchback-cli-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('parseRepoRef', () => {
  it('parses owner/name', () => {
    expect(parseRepoRef('acme/webapp')).toEqual({
      owner: 'acme',
      name: 'webapp',
    });
  });

  it('rejects anything else with a readable message', () => {
    for (const bad of ['acme', 'acme/web/app', 'https://github.com/a/b', '']) {
      expect(() => parseRepoRef(bad)).toThrow(CliError);
    }
  });
});

describe('config file write → load round-trip', () => {
  it('round-trips every field through the annotation-free template', async () => {
    const dir = await makeTempDir();
    const config = {
      repo: 'acme/webapp',
      testCommands: ['pnpm test', 'pnpm lint'],
      port: 9191,
      appOrigins: ['http://localhost:3000'],
      baseBranch: 'main',
      maxChangedLines: 150,
    };
    await writeConfigFile(dir, config);
    const loaded = await loadConfigFile(dir);
    expect(loaded).toEqual(config);
  });

  it('the rendered template contains no secret-shaped content', () => {
    const rendered = renderConfigFile({ repo: 'acme/webapp' });
    expect(rendered).toContain('Secrets NEVER belong here');
    expect(rendered).not.toMatch(/github_pat_|sk-ant-/);
  });

  it('missing config file → readable pointer at `patchback init`', async () => {
    const dir = await makeTempDir();
    await expect(loadConfigFile(dir)).rejects.toThrow(/patchback init/);
  });

  it('TypeScript-only syntax → readable error, not a stack trace', async () => {
    const dir = await makeTempDir();
    await writeFile(
      path.join(dir, CONFIG_FILE_NAME),
      'const config: { repo: string } = { repo: "acme/webapp" };\nexport default config;\n',
      'utf8',
    );
    await expect(loadConfigFile(dir)).rejects.toThrow(/annotation-free/);
  });

  it('a user-edited config (still valid JS) loads fine', async () => {
    const dir = await makeTempDir();
    await writeFile(
      path.join(dir, CONFIG_FILE_NAME),
      [
        '// hand-edited',
        'const config = {',
        "  repo: 'acme/webapp',",
        '  port: 3999,',
        '};',
        'export default config;',
        '',
      ].join('\n'),
      'utf8',
    );
    const loaded = await loadConfigFile(dir);
    expect(loaded).toEqual({ repo: 'acme/webapp', port: 3999 });
  });
});

describe('validatePatchbackConfig', () => {
  it('requires repo', () => {
    expect(() => validatePatchbackConfig({})).toThrow(/"repo" is required/);
  });

  it('rejects wrong-typed fields with the field name in the message', () => {
    expect(() =>
      validatePatchbackConfig({ repo: 'a/b', port: 'oops' }),
    ).toThrow(/"port"/);
    expect(() =>
      validatePatchbackConfig({ repo: 'a/b', appOrigins: 'http://x' }),
    ).toThrow(/"appOrigins"/);
  });
});
