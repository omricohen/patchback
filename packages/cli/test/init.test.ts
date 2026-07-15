import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { CONFIG_FILE_NAME } from '../src/config-file.js';
import { CliError } from '../src/errors.js';
import { runInit } from '../src/init.js';

const GITHUB_TOKEN = 'github_pat_11TESTTOKENVALUE0000000000';
const ANTHROPIC_KEY = 'sk-ant-test-key-000000000000000000';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'patchback-init-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/** Feed scripted answers; capture everything printed. */
function makeStreams(answers: string[]): {
  input: PassThrough;
  output: PassThrough;
  printed: () => string;
} {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(chunk));
  input.end(`${answers.join('\n')}\n`);
  return {
    input,
    output,
    printed: () => Buffer.concat(chunks).toString('utf8'),
  };
}

function healthyGitHub(): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/contents/package.json')) {
      return new Response(
        JSON.stringify({
          content: Buffer.from(
            JSON.stringify({ scripts: { test: 'vitest run' } }),
          ).toString('base64'),
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({ permissions: { push: true }, has_issues: true }),
      { status: 200 },
    );
  }) as typeof globalThis.fetch;
}

describe('patchback init (first-run config writer)', () => {
  it('writes patchback.config.ts (no secrets) and .env (secrets), never echoing secrets', async () => {
    const dir = await makeTempDir();
    const streams = makeStreams([
      'acme/webapp', // repo
      GITHUB_TOKEN, // token (hidden)
      ANTHROPIC_KEY, // anthropic key (hidden)
      'pnpm test', // test commands
      '', // app origin → default
    ]);
    const result = await runInit({
      cwd: dir,
      input: streams.input,
      output: streams.output,
      fetchImpl: healthyGitHub(),
    });

    // Config file: settings present, secrets absent.
    const configSource = await readFile(result.configPath, 'utf8');
    expect(configSource).toContain('repo: "acme/webapp"');
    expect(configSource).toContain('pnpm test');
    expect(configSource).toContain('http://localhost:3000');
    expect(configSource).not.toContain(GITHUB_TOKEN);
    expect(configSource).not.toContain(ANTHROPIC_KEY);

    // .env: both secrets stored.
    const envSource = await readFile(result.envPath, 'utf8');
    expect(envSource).toContain(`GITHUB_TOKEN=${GITHUB_TOKEN}`);
    expect(envSource).toContain(`ANTHROPIC_API_KEY=${ANTHROPIC_KEY}`);

    // Terminal output: never the secrets themselves.
    const printed = streams.printed();
    expect(printed).not.toContain(GITHUB_TOKEN);
    expect(printed).not.toContain(ANTHROPIC_KEY);
    expect(printed).toContain('Token validated against GitHub');
    expect(printed).toContain('values not shown');
  });

  it('re-prompts on a bad token with the actionable probe message', async () => {
    const dir = await makeTempDir();
    const badToken = 'github_pat_11WRONG000000000000000000';
    let calls = 0;
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/contents/package.json')) {
        return new Response(null, { status: 404 });
      }
      calls += 1;
      return calls === 1
        ? new Response(null, { status: 401 })
        : new Response(
            JSON.stringify({ permissions: { push: true }, has_issues: true }),
            { status: 200 },
          );
    }) as typeof globalThis.fetch;

    const streams = makeStreams([
      'acme/webapp',
      badToken, // rejected (401)
      GITHUB_TOKEN, // accepted
      '', // anthropic key skipped
      'npm test',
      '',
    ]);
    const result = await runInit({
      cwd: dir,
      input: streams.input,
      output: streams.output,
      fetchImpl,
    });
    const printed = streams.printed();
    expect(printed).toContain('401');
    expect(printed).toContain('Try again');
    // The no-test-script preflight surfaced its clear message.
    expect(printed).toContain('no package.json');
    // Missing Anthropic key → recorded warning, not a crash.
    expect(result.warnings.join('\n')).toContain('No Anthropic API key');
    const envSource = await readFile(result.envPath, 'utf8');
    expect(envSource).toContain(`GITHUB_TOKEN=${GITHUB_TOKEN}`);
    expect(envSource).not.toContain('ANTHROPIC_API_KEY=');
    expect(printed).not.toContain(badToken);
    expect(printed).not.toContain(GITHUB_TOKEN);
  });

  it('gives up after three bad tokens with a readable error', async () => {
    const dir = await makeTempDir();
    const streams = makeStreams([
      'acme/webapp',
      'github_pat_bad_1_000000000000',
      'github_pat_bad_2_000000000000',
      'github_pat_bad_3_000000000000',
    ]);
    await expect(
      runInit({
        cwd: dir,
        input: streams.input,
        output: streams.output,
        fetchImpl: (async () =>
          new Response(null, { status: 401 })) as typeof globalThis.fetch,
      }),
    ).rejects.toThrow(/after 3 attempts/);
  });

  it('refuses to overwrite an existing config without --force', async () => {
    const dir = await makeTempDir();
    await writeFile(path.join(dir, CONFIG_FILE_NAME), '// existing\n');
    const streams = makeStreams([]);
    await expect(
      runInit({ cwd: dir, input: streams.input, output: streams.output }),
    ).rejects.toThrow(CliError);
  });

  it('adds .env and the config file to .gitignore in a git work tree', async () => {
    const dir = await makeTempDir();
    await mkdir(path.join(dir, '.git'));
    await writeFile(path.join(dir, '.gitignore'), 'node_modules/\n');
    const streams = makeStreams([
      'acme/webapp',
      GITHUB_TOKEN,
      '',
      'npm test',
      '',
    ]);
    await runInit({
      cwd: dir,
      input: streams.input,
      output: streams.output,
      skipProbe: true,
    });
    const gitignore = await readFile(path.join(dir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('node_modules/');
    expect(gitignore).toContain('.env');
    expect(gitignore).toContain(CONFIG_FILE_NAME);
  });

  it('warns but continues when GitHub is unreachable (offline)', async () => {
    const dir = await makeTempDir();
    const streams = makeStreams([
      'acme/webapp',
      GITHUB_TOKEN,
      ANTHROPIC_KEY,
      'npm test',
      '',
    ]);
    const result = await runInit({
      cwd: dir,
      input: streams.input,
      output: streams.output,
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof globalThis.fetch,
    });
    expect(result.warnings.join('\n')).toContain('offline');
    const envSource = await readFile(result.envPath, 'utf8');
    expect(envSource).toContain(`GITHUB_TOKEN=${GITHUB_TOKEN}`);
  });
});
