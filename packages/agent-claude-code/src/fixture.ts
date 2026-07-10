import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGit, type TaskBrief } from '@patchback/agent-core';

/**
 * Test fixtures for the adapter suites: a tiny local "target repo" with a
 * button label to change and a runnable check script, plus the standard brief
 * for the acceptance flow ("change button label X to Y").
 */

export const BUTTON_FILE = 'src/button.js';
export const OLD_LABEL = 'Save changes';
export const NEW_LABEL = 'Submit changes';

/** Absolute path to the fake Claude Code CLI script. */
export function fakeCliPath(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'test',
    'fixtures',
    'fake-claude.mjs',
  );
}

/**
 * Create a committed git repo in `dir` containing:
 * - `src/button.js` with the OLD_LABEL button label
 * - a real `test` script (validates the button file) and a `lint` script
 * - `package-lock.json` so the repo-reader detects npm
 */
export async function createFixtureRepo(dir: string): Promise<void> {
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await mkdir(path.join(dir, 'scripts'), { recursive: true });

  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'patchback-fixture-app',
        version: '1.0.0',
        private: true,
        scripts: {
          lint: 'node scripts/check-button.mjs',
          test: 'node scripts/check-button.mjs',
        },
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(
    path.join(dir, 'package-lock.json'),
    JSON.stringify({ name: 'patchback-fixture-app', lockfileVersion: 3 }) +
      '\n',
  );
  await writeFile(
    path.join(dir, BUTTON_FILE),
    [
      'export const saveButton = {',
      `  label: '${OLD_LABEL}',`,
      "  variant: 'primary',",
      '};',
      '',
    ].join('\n'),
  );
  // Label-agnostic check: the button must exist and declare *a* label.
  await writeFile(
    path.join(dir, 'scripts', 'check-button.mjs'),
    [
      "import { readFileSync } from 'node:fs';",
      `const source = readFileSync('${BUTTON_FILE}', 'utf8');`,
      "if (!/label: '[^']+'/.test(source)) {",
      "  console.error('button label missing');",
      '  process.exit(1);',
      '}',
      "console.log('button check ok');",
      '',
    ].join('\n'),
  );
  await writeFile(path.join(dir, 'README.md'), '# Fixture app\n');

  await runGit(dir, ['init', '--quiet', '--initial-branch=main']);
  await runGit(dir, ['config', 'user.email', 'fixture@example.com']);
  await runGit(dir, ['config', 'user.name', 'Patchback Fixture']);
  await runGit(dir, ['add', '.']);
  await runGit(dir, ['commit', '--quiet', '-m', 'init fixture app']);
}

/** The canonical acceptance brief: change button label OLD_LABEL → NEW_LABEL. */
export function labelChangeBrief(): TaskBrief {
  return {
    title: `Change button label "${OLD_LABEL}" to "${NEW_LABEL}"`,
    description:
      `The primary button in ${BUTTON_FILE} currently reads ` +
      `"${OLD_LABEL}"; it should read "${NEW_LABEL}".`,
    constraints: ['Only change the label text.'],
    fileHints: [BUTTON_FILE],
    acceptanceCriteria: [
      `The button label is "${NEW_LABEL}".`,
      'No other behavior changes.',
    ],
    feedbackId: 'feedback-fixture-1',
  };
}
