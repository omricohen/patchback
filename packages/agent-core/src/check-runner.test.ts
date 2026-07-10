import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectAndRunChecks, detectChecks, runChecks } from './check-runner.js';

describe('detectChecks', () => {
  it('detects lint, typecheck, and test in fixed order', () => {
    const detected = detectChecks({
      test: 'vitest run',
      lint: 'eslint .',
      typecheck: 'tsc --noEmit',
      build: 'tsc',
    });
    expect(detected.map((check) => check.name)).toEqual([
      'lint',
      'typecheck',
      'test',
    ]);
    expect(detected.map((check) => check.scriptKey)).toEqual([
      'lint',
      'typecheck',
      'test',
    ]);
  });

  it('accepts typecheck aliases', () => {
    expect(detectChecks({ 'type-check': 'tsc --noEmit' })[0]?.scriptKey).toBe(
      'type-check',
    );
    expect(detectChecks({ tsc: 'tsc --noEmit' })[0]?.scriptKey).toBe('tsc');
  });

  it('skips the npm scaffold test placeholder', () => {
    const detected = detectChecks({
      test: 'echo "Error: no test specified" && exit 1',
    });
    expect(detected).toEqual([]);
  });

  it('skips empty scripts and returns [] when nothing matches', () => {
    expect(detectChecks({ lint: '   ' })).toEqual([]);
    expect(detectChecks({})).toEqual([]);
  });
});

describe('runChecks', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(path.join(os.tmpdir(), 'patchback-checks-test-'));
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  async function writePackageJson(
    scripts: Record<string, string>,
  ): Promise<Record<string, string>> {
    await writeFile(
      path.join(repoDir, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '0.0.0', scripts }),
    );
    return scripts;
  }

  it('runs detected checks via the package manager and reports pass', async () => {
    const scripts = await writePackageJson({
      lint: 'node -e "console.log(\'lint ok\')"',
      test: 'node -e "console.log(\'tests ok\')"',
    });
    const report = await detectAndRunChecks(repoDir, scripts, {
      packageManager: 'npm',
      timeoutMs: 60_000,
    });
    expect(report.allPassed).toBe(true);
    expect(report.skipped).toEqual(['typecheck']);
    expect(report.ran).toHaveLength(2);
    const lint = report.ran[0]!;
    expect(lint.name).toBe('lint');
    expect(lint.command).toBe('npm run lint');
    expect(lint.passed).toBe(true);
    expect(lint.exitCode).toBe(0);
    expect(lint.outputTail).toContain('lint ok');
  }, 60_000);

  it('reports failure with exit code and output tail', async () => {
    const scripts = await writePackageJson({
      test: 'node -e "console.error(\'boom: assertion failed\'); process.exit(3)"',
    });
    const report = await detectAndRunChecks(repoDir, scripts, {
      packageManager: 'npm',
      timeoutMs: 60_000,
    });
    expect(report.allPassed).toBe(false);
    const test = report.ran[0]!;
    expect(test.passed).toBe(false);
    // npm run propagates the script's exit code (may be remapped to 1 by some PMs).
    expect(test.exitCode).not.toBe(0);
    expect(test.outputTail).toContain('boom: assertion failed');
  }, 60_000);

  it('kills a hung check at the timeout and marks it failed', async () => {
    const scripts = await writePackageJson({
      test: 'node -e "setTimeout(() => {}, 120000)"',
    });
    const report = await detectAndRunChecks(repoDir, scripts, {
      packageManager: 'npm',
      timeoutMs: 3_000,
    });
    const test = report.ran[0]!;
    expect(test.passed).toBe(false);
    expect(test.error).toMatch(/timed out/i);
  }, 60_000);

  it('is vacuously green when no checks are detected', async () => {
    const report = await runChecks(repoDir, []);
    expect(report.allPassed).toBe(true);
    expect(report.ran).toEqual([]);
    expect(report.skipped).toEqual(['lint', 'typecheck', 'test']);
  });

  it('truncates long output to the tail cap', async () => {
    const scripts = await writePackageJson({
      test: 'node -e "process.stdout.write(\'y\'.repeat(10000))"',
    });
    const report = await detectAndRunChecks(repoDir, scripts, {
      packageManager: 'npm',
      timeoutMs: 60_000,
      outputTailChars: 500,
    });
    const test = report.ran[0]!;
    expect(test.outputTail.length).toBeLessThan(600);
    expect(test.outputTail).toContain('[output truncated]');
  }, 60_000);
});
