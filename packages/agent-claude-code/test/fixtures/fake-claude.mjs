/**
 * Fake Claude Code CLI for adapter unit tests.
 *
 * Invoked as: node fake-claude.mjs -p --output-format json [...]
 * Reads the prompt from stdin (like the real CLI in print mode), performs a
 * scripted action in the current working directory, and prints a result JSON
 * object shaped like `claude -p --output-format json` output.
 *
 * Behavior is controlled via environment variables so tests can drive
 * scenarios without changing spawn logic:
 *
 *   FAKE_CLAUDE_MODE            label-change | huge-diff | no-op | garbage |
 *                               cli-error | crash | hang   (default label-change)
 *   FAKE_CLAUDE_TARGET_FILE     file to edit for label-change (cwd-relative)
 *   FAKE_CLAUDE_FROM / _TO      label text to replace / replacement
 *   FAKE_CLAUDE_PROMPT_CAPTURE  absolute path; the received prompt is written
 *                               here so tests can assert on it without
 *                               dirtying the work tree
 */
import { readFileSync, writeFileSync } from 'node:fs';

const prompt = readFileSync(0, 'utf8');
const mode = process.env.FAKE_CLAUDE_MODE ?? 'label-change';

if (process.env.FAKE_CLAUDE_PROMPT_CAPTURE) {
  writeFileSync(process.env.FAKE_CLAUDE_PROMPT_CAPTURE, prompt);
}

function printResult(resultText, isError = false) {
  process.stdout.write(
    JSON.stringify({
      type: 'result',
      subtype: isError ? 'error_during_execution' : 'success',
      is_error: isError,
      result: resultText,
      duration_ms: 42,
      num_turns: 1,
      session_id: 'fake-session',
    }),
  );
}

switch (mode) {
  case 'label-change': {
    const file = process.env.FAKE_CLAUDE_TARGET_FILE ?? 'src/button.js';
    const from = process.env.FAKE_CLAUDE_FROM ?? 'Save changes';
    const to = process.env.FAKE_CLAUDE_TO ?? 'Submit changes';
    const content = readFileSync(file, 'utf8');
    if (!content.includes(from)) {
      printResult(
        `Could not find label ${JSON.stringify(from)} in ${file}`,
        true,
      );
      process.exit(1);
    }
    writeFileSync(file, content.replaceAll(from, to));
    printResult(
      `Changed label ${JSON.stringify(from)} to ${JSON.stringify(to)} in ${file}.`,
    );
    break;
  }
  case 'huge-diff': {
    const lines = Array.from(
      { length: 400 },
      (_, i) => `const line${i} = ${i};`,
    );
    writeFileSync('generated-rewrite.js', lines.join('\n') + '\n');
    printResult('Rewrote the module (400 lines).');
    break;
  }
  case 'no-op': {
    printResult('Everything already looks correct; no changes needed.');
    break;
  }
  case 'garbage': {
    // Non-JSON output, but the edit still happens — the diff is what counts.
    const file = process.env.FAKE_CLAUDE_TARGET_FILE ?? 'src/button.js';
    const from = process.env.FAKE_CLAUDE_FROM ?? 'Save changes';
    const to = process.env.FAKE_CLAUDE_TO ?? 'Submit changes';
    writeFileSync(file, readFileSync(file, 'utf8').replaceAll(from, to));
    process.stdout.write('plain text, definitely not JSON\n');
    break;
  }
  case 'cli-error': {
    process.stderr.write('fatal: model refused to cooperate\n');
    printResult('I was unable to complete the task.', true);
    process.exit(1);
    break;
  }
  case 'crash': {
    process.stderr.write('segfault (not really)\n');
    process.exit(2);
    break;
  }
  case 'hang': {
    setTimeout(() => {
      /* never settles within test timeouts */
    }, 120_000);
    break;
  }
  default: {
    process.stderr.write(`unknown FAKE_CLAUDE_MODE: ${mode}\n`);
    process.exit(64);
  }
}
