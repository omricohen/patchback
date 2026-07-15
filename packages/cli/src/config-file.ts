import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { CliError } from './errors.js';

export const CONFIG_FILE_NAME = 'patchback.config.ts';

/**
 * Non-secret Patchback settings, stored in `patchback.config.ts` in the
 * project root. Secrets (GITHUB_TOKEN, ANTHROPIC_API_KEY) NEVER belong in
 * this file — they live in `.env`, which is gitignored.
 */
export interface PatchbackConfig {
  /** Target repository as `owner/name`. Generated PRs land here. */
  repo: string;
  /**
   * How the target repo runs its checks — informational for now: the patch
   * pipeline runs the target repo's OWN package.json scripts (lint /
   * typecheck / test), so these are recorded from first-run to make the "no
   * test script" conversation explicit, not to override detection.
   */
  testCommands?: string[];
  /** Port for the local API. Default 8787. */
  port?: number;
  /**
   * Origins your app is served from (CORS allow-list for the widget's
   * cross-origin calls), e.g. ["http://localhost:3000"]. Exact origins only —
   * a wildcard is rejected.
   */
  appOrigins?: string[];
  /** Base branch PRs target. Defaults to the repo's default branch. */
  baseBranch?: string;
  /**
   * Clone from a local checkout instead of GitHub (faster agent runs; the
   * PR still opens against `repo` on GitHub).
   */
  localRepoPath?: string;
  /** Diff-size ceiling for the agent (changed lines). Default 300. */
  maxChangedLines?: number;
  /** Triage model id override (see @patchback/triage for the default). */
  triageModel?: string;
}

export function parseRepoRef(repo: string): { owner: string; name: string } {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repo.trim());
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new CliError(
      `"${repo}" is not an owner/name repository reference (e.g. "acme/webapp")`,
    );
  }
  return { owner: match[1], name: match[2] };
}

/** Runtime validation — the config file is outside-the-compiler input. */
export function validatePatchbackConfig(value: unknown): PatchbackConfig {
  if (typeof value !== 'object' || value === null) {
    throw new CliError(
      `${CONFIG_FILE_NAME} must default-export a config object`,
    );
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.repo !== 'string') {
    throw new CliError(
      `${CONFIG_FILE_NAME}: "repo" is required — the owner/name of the target repository`,
    );
  }
  parseRepoRef(raw.repo);
  const stringArray = (key: string): string[] | undefined => {
    const entry = raw[key];
    if (entry === undefined) return undefined;
    if (
      !Array.isArray(entry) ||
      entry.some((item) => typeof item !== 'string')
    ) {
      throw new CliError(
        `${CONFIG_FILE_NAME}: "${key}" must be an array of strings`,
      );
    }
    return entry as string[];
  };
  const optionalString = (key: string): string | undefined => {
    const entry = raw[key];
    if (entry !== undefined && typeof entry !== 'string') {
      throw new CliError(`${CONFIG_FILE_NAME}: "${key}" must be a string`);
    }
    return entry as string | undefined;
  };
  const optionalNumber = (key: string): number | undefined => {
    const entry = raw[key];
    if (entry === undefined) return undefined;
    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry <= 0) {
      throw new CliError(
        `${CONFIG_FILE_NAME}: "${key}" must be a positive number`,
      );
    }
    return entry;
  };
  const config: PatchbackConfig = { repo: raw.repo };
  const assign = <K extends keyof PatchbackConfig>(
    key: K,
    val: PatchbackConfig[K] | undefined,
  ): void => {
    if (val !== undefined) config[key] = val;
  };
  assign('testCommands', stringArray('testCommands'));
  assign('appOrigins', stringArray('appOrigins'));
  assign('port', optionalNumber('port'));
  assign('maxChangedLines', optionalNumber('maxChangedLines'));
  assign('baseBranch', optionalString('baseBranch'));
  assign('localRepoPath', optionalString('localRepoPath'));
  assign('triageModel', optionalString('triageModel'));
  return config;
}

/**
 * Render the config file. The template is deliberately annotation-free
 * (JSDoc type only): it is valid TypeScript AND valid JavaScript, so
 * `patchback dev` can load it with Node alone — no TypeScript compiler at
 * runtime. Keep it that way when editing.
 */
export function renderConfigFile(config: PatchbackConfig): string {
  const lines: string[] = [
    `// ${CONFIG_FILE_NAME} — Patchback settings (non-secret).`,
    '//',
    '// Secrets NEVER belong here: GITHUB_TOKEN and ANTHROPIC_API_KEY live in',
    '// .env (gitignored). This file may be committed if you want to share',
    '// settings, but `patchback init` suggests gitignoring it by default.',
    '//',
    '// Keep this file annotation-free (JSDoc types only): `patchback dev`',
    '// loads it directly with Node, without a TypeScript compiler.',
    '',
    "/** @type {import('patchback').PatchbackConfig} */",
    'const config = {',
    `  repo: ${JSON.stringify(config.repo)},`,
  ];
  if (config.testCommands !== undefined && config.testCommands.length > 0) {
    lines.push(`  testCommands: ${JSON.stringify(config.testCommands)},`);
  }
  lines.push(`  port: ${config.port ?? 8787},`);
  if (config.appOrigins !== undefined && config.appOrigins.length > 0) {
    lines.push(`  appOrigins: ${JSON.stringify(config.appOrigins)},`);
  } else {
    lines.push(
      "  // appOrigins: ['http://localhost:3000'], // CORS allow-list for your app",
    );
  }
  if (config.baseBranch !== undefined) {
    lines.push(`  baseBranch: ${JSON.stringify(config.baseBranch)},`);
  } else {
    lines.push("  // baseBranch: 'main',");
  }
  if (config.localRepoPath !== undefined) {
    lines.push(`  localRepoPath: ${JSON.stringify(config.localRepoPath)},`);
  } else {
    lines.push(
      "  // localRepoPath: '/path/to/local/checkout', // clone locally instead of GitHub",
    );
  }
  if (config.maxChangedLines !== undefined) {
    lines.push(`  maxChangedLines: ${config.maxChangedLines},`);
  }
  if (config.triageModel !== undefined) {
    lines.push(`  triageModel: ${JSON.stringify(config.triageModel)},`);
  }
  lines.push('};', '', 'export default config;', '');
  return lines.join('\n');
}

export async function writeConfigFile(
  cwd: string,
  config: PatchbackConfig,
): Promise<string> {
  const filePath = path.join(cwd, CONFIG_FILE_NAME);
  await writeFile(filePath, renderConfigFile(config), 'utf8');
  return filePath;
}

/**
 * Load `patchback.config.ts`. The file is imported as an ES module via a
 * data: URL — which works exactly because the template is annotation-free
 * (valid JS). TypeScript-only syntax produces a readable error instead of a
 * stack trace.
 */
export async function loadConfigFile(cwd: string): Promise<PatchbackConfig> {
  const filePath = path.join(cwd, CONFIG_FILE_NAME);
  let source: string;
  try {
    source = await readFile(filePath, 'utf8');
  } catch {
    throw new CliError(
      `No ${CONFIG_FILE_NAME} found in ${cwd}.\nRun \`patchback init\` first (or \`patchback dev\` runs it for you).`,
    );
  }
  let moduleExports: { default?: unknown };
  try {
    const dataUrl = `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
    moduleExports = (await import(dataUrl)) as { default?: unknown };
  } catch (error) {
    throw new CliError(
      `Could not load ${CONFIG_FILE_NAME}: ${error instanceof Error ? error.message : String(error)}\n` +
        'The config file must stay annotation-free (plain object + JSDoc types) ' +
        'so Node can load it without a TypeScript compiler — see the template header.',
    );
  }
  return validatePatchbackConfig(moduleExports.default);
}
