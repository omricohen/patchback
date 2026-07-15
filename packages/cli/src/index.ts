#!/usr/bin/env node
/**
 * The `patchback` CLI.
 *
 *   patchback init   — interactive first-run: token, key, repo, tests →
 *                      writes patchback.config.ts (settings) + .env (secrets)
 *   patchback dev    — boots the API in-memory (no Redis/Postgres), runs the
 *                      triage + patch workers in-process, serves + prints the
 *                      widget snippet, and streams job logs to the terminal
 *
 * Library surface: the pieces are exported so tests (and adventurous users)
 * can compose the same dev harness with injected seams.
 */
import { realpathSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { loadConfigFile, CONFIG_FILE_NAME } from './config-file.js';
import { runDev, renderDevBanner } from './dev.js';
import { loadDotEnv } from './env.js';
import { CliError } from './errors.js';
import { runInit } from './init.js';

export type { PatchbackConfig } from './config-file.js';
export {
  CONFIG_FILE_NAME,
  loadConfigFile,
  parseRepoRef,
  renderConfigFile,
  validatePatchbackConfig,
  writeConfigFile,
} from './config-file.js';
export { CliError } from './errors.js';
export { loadDotEnv, parseDotEnv, upsertDotEnv } from './env.js';
export {
  probeGitHubToken,
  probeRepoScripts,
  type TokenProbeResult,
} from './github-probe.js';
export {
  explainPatchFailure,
  formatPatchFailure,
  type FailureExplanation,
} from './failures.js';
export {
  createDevLogger,
  instrumentStore,
  type DevLogger,
  type InstrumentedStore,
  type LogSink,
} from './logging.js';
export {
  startPrPoller,
  type PrPoller,
  type PrPollerOptions,
} from './pr-poller.js';
export { buildWidgetSnippet } from './snippet.js';
export {
  renderDevBanner,
  resolveWidgetBundlePath,
  runDev,
  type DevHandle,
  type DevOptions,
  type DevSeams,
  type DevSecrets,
} from './dev.js';
export { runInit, type InitOptions, type InitResult } from './init.js';

const HELP = `patchback — feedback → triage → agent → pull request (dev loop)

Usage:
  patchback init [--force]     Interactive setup (writes ${CONFIG_FILE_NAME} + .env)
  patchback dev [--port N]     Run the local API + workers + widget (in-memory)
  patchback help               Show this help
  patchback version            Print the version

patchback dev needs no Redis and no Postgres. Secrets are read from the
environment / .env (GITHUB_TOKEN, ANTHROPIC_API_KEY) and are never printed.
`;

async function commandDev(args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    options: { port: { type: 'string' } },
    allowPositionals: false,
  });
  const cwd = process.cwd();
  await loadDotEnv(cwd);

  let config;
  try {
    config = await loadConfigFile(cwd);
  } catch (error) {
    if (error instanceof CliError && error.message.startsWith('No ')) {
      process.stdout.write(
        `No ${CONFIG_FILE_NAME} here — running first-time setup.\n\n`,
      );
      await runInit({ cwd, input: process.stdin, output: process.stdout });
      await loadDotEnv(cwd); // Pick up the freshly written secrets.
      config = await loadConfigFile(cwd);
    } else {
      throw error;
    }
  }

  let port: number | undefined;
  if (parsed.values.port !== undefined) {
    port = Number(parsed.values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new CliError(
        `--port must be a valid port number, got "${parsed.values.port}"`,
      );
    }
  }

  const handle = await runDev({
    config,
    secrets: {
      ...(process.env.GITHUB_TOKEN !== undefined
        ? { githubToken: process.env.GITHUB_TOKEN }
        : {}),
      ...(process.env.ANTHROPIC_API_KEY !== undefined
        ? { anthropicApiKey: process.env.ANTHROPIC_API_KEY }
        : {}),
    },
    ...(port !== undefined ? { port } : {}),
    color: process.stdout.isTTY === true,
  });

  process.stdout.write(renderDevBanner(handle, config.repo));

  const shutdown = (): void => {
    process.stdout.write('\nShutting down…\n');
    void handle.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function commandInit(args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    options: { force: { type: 'boolean' } },
    allowPositionals: false,
  });
  await runInit({
    cwd: process.cwd(),
    input: process.stdin,
    output: process.stdout,
    ...(parsed.values.force === true ? { force: true } : {}),
  });
}

async function readOwnVersion(): Promise<string> {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const pkg = require('../package.json') as { version: string };
  return pkg.version;
}

export async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'dev':
      await commandDev(rest);
      return;
    case 'init':
      await commandInit(rest);
      return;
    case 'version':
    case '--version':
    case '-v':
      process.stdout.write(`${await readOwnVersion()}\n`);
      return;
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(HELP);
      return;
    default:
      throw new CliError(`Unknown command "${command}".\n\n${HELP}`);
  }
}

function isDirectlyExecuted(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return (
      realpathSync(entry) === realpathSync(new URL(import.meta.url).pathname)
    );
  } catch {
    return false;
  }
}

if (isDirectlyExecuted()) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    if (error instanceof CliError) {
      process.stderr.write(`\n${error.message}\n`);
    } else {
      console.error(error);
    }
    process.exit(1);
  });
}
