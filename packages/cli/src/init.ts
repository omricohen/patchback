import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  CONFIG_FILE_NAME,
  parseRepoRef,
  writeConfigFile,
  type PatchbackConfig,
} from './config-file.js';
import { upsertDotEnv } from './env.js';
import { CliError } from './errors.js';
import { probeGitHubToken, probeRepoScripts } from './github-probe.js';
import { createPrompter } from './prompts.js';
import { renderWorkflow } from './workflow-template.js';

/**
 * Interactive first run: collect the GitHub token, the Anthropic API key,
 * the target repo, and the repo's test commands; validate the token with a
 * real API call when online; write `patchback.config.ts` (non-secret) and
 * `.env` (secrets, chmod 600).
 *
 * Secrets are typed with echo suppressed and are NEVER printed back — not
 * in the summary, not in errors, not partially.
 */
export interface InitOptions {
  cwd: string;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  fetchImpl?: typeof globalThis.fetch;
  /** Overwrite an existing config file. */
  force?: boolean;
  /** Skip the online token probe (offline machines, tests). */
  skipProbe?: boolean;
}

export interface InitResult {
  configPath: string;
  envPath: string;
  config: PatchbackConfig;
  warnings: string[];
}

const MAX_TOKEN_ATTEMPTS = 3;

export async function runInit(options: InitOptions): Promise<InitResult> {
  const { cwd, output } = options;
  const configPath = path.join(cwd, CONFIG_FILE_NAME);
  if (existsSync(configPath) && options.force !== true) {
    throw new CliError(
      `${CONFIG_FILE_NAME} already exists in ${cwd}. ` +
        'Re-run with --force to overwrite it (your .env is left untouched either way).',
    );
  }

  const prompter = createPrompter(options.input, output);
  const say = (line: string): void => {
    output.write(`${line}\n`);
  };
  const warnings: string[] = [];
  const warn = (message: string): void => {
    warnings.push(message);
    say(`! ${message}`);
  };

  try {
    say('Patchback first-run setup. Secrets go to .env; settings go to');
    say(`${CONFIG_FILE_NAME}. Nothing is sent anywhere except GitHub`);
    say('(one token-validation call).');
    say('');

    // --- Target repo -------------------------------------------------------
    let repoAnswer = '';
    for (;;) {
      repoAnswer = await prompter.ask('Target GitHub repository (owner/name)');
      try {
        parseRepoRef(repoAnswer);
        break;
      } catch (error) {
        say(`  ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const repo = parseRepoRef(repoAnswer);

    // --- GitHub token (validated live when possible) ------------------------
    let githubToken = '';
    let tokenOk = false;
    for (let attempt = 1; attempt <= MAX_TOKEN_ATTEMPTS; attempt += 1) {
      githubToken = await prompter.ask(
        'GitHub fine-grained personal access token',
        { hidden: true },
      );
      if (githubToken === '') {
        say(
          '  A token is required — Patchback opens issues, branches, and PRs.',
        );
        continue;
      }
      if (options.skipProbe === true) {
        tokenOk = true;
        break;
      }
      const probe = await probeGitHubToken({
        token: githubToken,
        owner: repo.owner,
        repo: repo.name,
        ...(options.fetchImpl !== undefined
          ? { fetchImpl: options.fetchImpl }
          : {}),
      });
      if (probe.ok) {
        say('  Token validated against GitHub.');
        for (const warning of probe.warnings) {
          warn(warning);
        }
        tokenOk = true;
        break;
      }
      if (probe.offline) {
        warn(probe.message);
        tokenOk = true; // Can't validate offline; keep what was typed.
        break;
      }
      say(`  ${probe.message}`);
      if (attempt < MAX_TOKEN_ATTEMPTS) {
        say('  Try again with a corrected token.');
      }
    }
    if (!tokenOk || githubToken === '') {
      throw new CliError(
        `Could not validate a GitHub token after ${MAX_TOKEN_ATTEMPTS} attempts. ` +
          'Fix the token permissions and re-run `patchback init`.',
      );
    }

    // --- Anthropic key -------------------------------------------------------
    const anthropicKey = await prompter.ask(
      'Anthropic API key (for triage + the Claude Code agent)',
      { hidden: true },
    );
    if (anthropicKey === '') {
      warn(
        'No Anthropic API key provided — `patchback dev` will refuse to start ' +
          'until ANTHROPIC_API_KEY is set in .env or the environment.',
      );
    }

    // --- Test commands -------------------------------------------------------
    if (options.skipProbe !== true) {
      const scriptsProbe = await probeRepoScripts({
        token: githubToken,
        owner: repo.owner,
        repo: repo.name,
        ...(options.fetchImpl !== undefined
          ? { fetchImpl: options.fetchImpl }
          : {}),
      });
      for (const warning of scriptsProbe.warnings) {
        warn(warning);
      }
    }
    const testCommandsAnswer = await prompter.ask(
      'How does the target repo run its tests? (comma-separated commands; ' +
        'the pipeline runs the repo’s own package.json scripts)',
      { defaultValue: 'npm test' },
    );
    const testCommands = testCommandsAnswer
      .split(',')
      .map((command) => command.trim())
      .filter((command) => command !== '');

    // --- App origin (CORS) ---------------------------------------------------
    const originAnswer = await prompter.ask(
      'Where does your app run during development? (origin for CORS)',
      { defaultValue: 'http://localhost:3000' },
    );

    // --- Write files ---------------------------------------------------------
    const config: PatchbackConfig = {
      repo: `${repo.owner}/${repo.name}`,
      testCommands,
      port: 8787,
      appOrigins: [originAnswer],
    };
    const writtenConfigPath = await writeConfigFile(cwd, config);
    const envEntries: Record<string, string> = {
      GITHUB_TOKEN: githubToken,
    };
    if (anthropicKey !== '') {
      envEntries.ANTHROPIC_API_KEY = anthropicKey;
    }
    const envPath = await upsertDotEnv(cwd, envEntries);
    await ensureGitignore(cwd, warn);

    say('');
    say(`Wrote ${writtenConfigPath} (settings — no secrets inside).`);
    say(
      `Wrote ${envPath} (GITHUB_TOKEN${anthropicKey !== '' ? ' + ANTHROPIC_API_KEY' : ''}, chmod 600 — values not shown).`,
    );
    say('Next: `patchback dev`');

    return { configPath: writtenConfigPath, envPath, config, warnings };
  } finally {
    prompter.close();
  }
}

export interface InitGithubActionOptions {
  cwd: string;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  /** Overwrite an existing workflow file. */
  force?: boolean;
  /** Inject the generated signing secret (tests); default: fresh random. */
  signingSecret?: string;
}

export interface InitGithubActionResult {
  configPath: string;
  workflowPath: string;
  /**
   * The freshly minted signing secret. Returned so callers/tests can confirm
   * it is printed ONCE and written to NO file. It is NEVER stored on disk.
   */
  signingSecret: string;
  warnings: string[];
}

/**
 * `patchback init --github-action`: scaffold Action mode into the CURRENT
 * repo. Writes the non-secret `patchback.config.ts` (reused writer) and
 * `.github/workflows/patchback.yml`, generates a fresh `PATCHBACK_SIGNING_SECRET`,
 * prints it ONCE with `gh secret set` instructions, and writes NO secret files
 * (secrets live only as GitHub repo secrets). The same signing secret must be
 * configured in the ingest — both sides share the symmetric HMAC key.
 */
export async function runInitGithubAction(
  options: InitGithubActionOptions,
): Promise<InitGithubActionResult> {
  const { cwd, output } = options;
  const configPath = path.join(cwd, CONFIG_FILE_NAME);
  if (existsSync(configPath) && options.force !== true) {
    throw new CliError(
      `${CONFIG_FILE_NAME} already exists in ${cwd}. ` +
        'Re-run with --force to overwrite it.',
    );
  }

  const prompter = createPrompter(options.input, output);
  const say = (line: string): void => {
    output.write(`${line}\n`);
  };
  const warnings: string[] = [];

  try {
    say(
      'Patchback GitHub Action setup. This writes a workflow + settings file',
    );
    say(
      'to THIS repo. Secrets are NEVER written to a file — they go to GitHub',
    );
    say('repo secrets, printed once below.');
    say('');

    // --- Target repo (this repo, on GitHub) --------------------------------
    let repoAnswer = '';
    for (;;) {
      repoAnswer = await prompter.ask(
        'GitHub repository this Action runs in (owner/name)',
      );
      try {
        parseRepoRef(repoAnswer);
        break;
      } catch (error) {
        say(`  ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const repo = parseRepoRef(repoAnswer);

    const baseBranch = await prompter.ask('Base branch PRs should target', {
      defaultValue: 'main',
    });
    const testCommandsAnswer = await prompter.ask(
      'How does the repo run its tests? (comma-separated; the pipeline runs ' +
        'the repo’s own package.json scripts)',
      { defaultValue: 'npm test' },
    );
    const testCommands = testCommandsAnswer
      .split(',')
      .map((command) => command.trim())
      .filter((command) => command !== '');

    // --- Write config + workflow (no secrets) ------------------------------
    const config: PatchbackConfig = {
      repo: `${repo.owner}/${repo.name}`,
      testCommands,
      baseBranch,
    };
    const writtenConfigPath = await writeConfigFile(cwd, config);

    const workflowDir = path.join(cwd, '.github', 'workflows');
    await mkdir(workflowDir, { recursive: true });
    const workflowPath = path.join(workflowDir, 'patchback.yml');
    await writeFile(workflowPath, renderWorkflow(), 'utf8');

    // --- Signing secret: minted, printed ONCE, never written to a file ------
    const signingSecret =
      options.signingSecret ?? randomBytes(32).toString('hex');

    say('');
    say(`Wrote ${writtenConfigPath} (settings — no secrets inside).`);
    say(`Wrote ${workflowPath} (least-privilege workflow).`);
    say('');
    say('Set these two GitHub repo secrets (values are NOT stored on disk):');
    say('');
    say(`  gh secret set ANTHROPIC_API_KEY --repo ${config.repo}`);
    say(`  gh secret set PATCHBACK_SIGNING_SECRET --repo ${config.repo}`);
    say('');
    say('PATCHBACK_SIGNING_SECRET (shown ONCE — copy it now, it will not be');
    say('shown again, and configure the SAME value in your ingest):');
    say('');
    say(`  ${signingSecret}`);
    say('');
    say('Then submit feedback to your ingest, which opens a labeled patchback');
    say(
      'issue and triggers the workflow. Every PR still needs a human review.',
    );

    return {
      configPath: writtenConfigPath,
      workflowPath,
      signingSecret,
      warnings,
    };
  } finally {
    prompter.close();
  }
}

/**
 * In a git work tree, make sure `.env` (secrets) and the config file are
 * ignored; warn loudly when we cannot.
 */
async function ensureGitignore(
  cwd: string,
  warn: (message: string) => void,
): Promise<void> {
  if (!existsSync(path.join(cwd, '.git'))) {
    return;
  }
  const gitignorePath = path.join(cwd, '.gitignore');
  let existing = '';
  if (existsSync(gitignorePath)) {
    existing = await readFile(gitignorePath, 'utf8');
  }
  const lines = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const missing = ['.env', CONFIG_FILE_NAME].filter(
    (entry) => !lines.has(entry) && !lines.has(`/${entry}`),
  );
  if (missing.length === 0) {
    return;
  }
  try {
    const prefix = existing === '' || existing.endsWith('\n') ? '' : '\n';
    await appendFile(
      gitignorePath,
      `${prefix}# Patchback (added by patchback init)\n${missing.join('\n')}\n`,
      'utf8',
    );
  } catch {
    warn(
      `Could not update .gitignore — add these entries yourself so secrets are never committed: ${missing.join(', ')}`,
    );
  }
}
