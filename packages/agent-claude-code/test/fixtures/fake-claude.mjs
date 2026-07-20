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
 *   FAKE_CLAUDE_MODE            label-change | dotdir-artifacts | huge-diff |
 *                               no-op | garbage | cli-error | crash | hang |
 *                               repair-fix | repair-fail | repair-exceed
 *                               (default label-change)
 *   FAKE_CLAUDE_TARGET_FILE     file to edit for label-change (cwd-relative)
 *   FAKE_CLAUDE_FROM / _TO      label text to replace / replacement
 *   FAKE_CLAUDE_PROMPT_CAPTURE  absolute path; the received prompt is written
 *                               here so tests can assert on it without
 *                               dirtying the work tree
 *   FAKE_CLAUDE_PROMPT_DIR      absolute dir; the received prompt is written to
 *                               `<dir>/prompt-<n>.txt` per invocation so tests
 *                               can assert on the repair (2nd) prompt
 *   FAKE_CLAUDE_COUNTER         absolute path to a counter file; each run
 *                               increments the integer inside and the repair
 *                               modes branch on 1st vs 2nd invocation
 *   FAKE_CLAUDE_SPAWN_CAPTURE   absolute path; argv + full env + whether the
 *                               CLAUDE_CONFIG_DIR exists are written here as
 *                               JSON so tests can pin spawn isolation
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const prompt = readFileSync(0, 'utf8');
const mode = process.env.FAKE_CLAUDE_MODE ?? 'label-change';

/**
 * Increment a persistent counter file (outside the work tree) so a mode can
 * tell the first invocation from the repair invocation. Returns the 1-based
 * run number; without a counter path configured, every run is "1".
 */
function invocationNumber() {
  const counterPath = process.env.FAKE_CLAUDE_COUNTER;
  if (!counterPath) return 1;
  let previous;
  try {
    previous =
      Number.parseInt(readFileSync(counterPath, 'utf8').trim(), 10) || 0;
  } catch {
    previous = 0;
  }
  const count = previous + 1;
  writeFileSync(counterPath, String(count));
  return count;
}

const run = invocationNumber();

if (process.env.FAKE_CLAUDE_PROMPT_CAPTURE) {
  writeFileSync(process.env.FAKE_CLAUDE_PROMPT_CAPTURE, prompt);
}
if (process.env.FAKE_CLAUDE_PROMPT_DIR) {
  mkdirSync(process.env.FAKE_CLAUDE_PROMPT_DIR, { recursive: true });
  writeFileSync(
    join(process.env.FAKE_CLAUDE_PROMPT_DIR, `prompt-${run}.txt`),
    prompt,
  );
}
if (process.env.FAKE_CLAUDE_SPAWN_CAPTURE) {
  writeFileSync(
    process.env.FAKE_CLAUDE_SPAWN_CAPTURE,
    JSON.stringify({
      argv: process.argv.slice(2),
      env: process.env,
      claudeConfigDirExists:
        typeof process.env.CLAUDE_CONFIG_DIR === 'string' &&
        existsSync(process.env.CLAUDE_CONFIG_DIR),
    }),
  );
}

/** Simulate a global hook/plugin writing its state into the working copy. */
function writeDotDirArtifacts() {
  mkdirSync('.a5c/cache', { recursive: true });
  mkdirSync('.a5c/logs', { recursive: true });
  writeFileSync(
    '.a5c/cache/hook-state.json',
    JSON.stringify({
      cwd: '/Users/example-user/private/some-client-project',
      plugin: 'example-stop-hook',
    }) + '\n',
  );
  writeFileSync(
    '.a5c/logs/stop-hook.log',
    'stop hook fired in /Users/example-user/private/some-client-project\n',
  );
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
  case 'dotdir-artifacts': {
    // A real change PLUS hook/plugin artifacts in a new top-level dot dir —
    // the sweep must publish the change and drop the artifacts.
    const file = process.env.FAKE_CLAUDE_TARGET_FILE ?? 'src/button.js';
    const from = process.env.FAKE_CLAUDE_FROM ?? 'Save changes';
    const to = process.env.FAKE_CLAUDE_TO ?? 'Submit changes';
    writeFileSync(file, readFileSync(file, 'utf8').replaceAll(from, to));
    writeDotDirArtifacts();
    printResult(`Changed label in ${file}. (Hook artifacts also appeared.)`);
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
  // --- Bounded-repair scenarios ------------------------------------------
  // All three break the button label on the first invocation (checks fail),
  // then behave differently on the repair (2nd) invocation. They operate on
  // the SAME working tree, so the cumulative diff carries across runs.
  case 'repair-fix': {
    // 1st: break the label (checks fail). Repair: set the correct label.
    const file = process.env.FAKE_CLAUDE_TARGET_FILE ?? 'src/button.js';
    const from = process.env.FAKE_CLAUDE_FROM ?? 'Save changes';
    const to = process.env.FAKE_CLAUDE_TO ?? 'Submit changes';
    const content = readFileSync(file, 'utf8');
    if (run === 1) {
      writeFileSync(file, content.replace(`label: '${from}'`, "label: ''"));
      printResult(`Set the label to empty in ${file}.`);
    } else {
      writeFileSync(file, content.replace("label: ''", `label: '${to}'`));
      printResult(`Repaired the label to ${JSON.stringify(to)} in ${file}.`);
    }
    break;
  }
  case 'repair-fail': {
    // 1st: break the label. Repair: still leaves it broken (append a comment
    // so the repair genuinely edits the tree, but the label stays empty).
    const file = process.env.FAKE_CLAUDE_TARGET_FILE ?? 'src/button.js';
    const from = process.env.FAKE_CLAUDE_FROM ?? 'Save changes';
    const content = readFileSync(file, 'utf8');
    if (run === 1) {
      writeFileSync(file, content.replace(`label: '${from}'`, "label: ''"));
      printResult(`Set the label to empty in ${file}.`);
    } else {
      writeFileSync(file, content + '// repair attempt (still broken)\n');
      printResult(`Tweaked ${file}, but the label is still empty.`);
    }
    break;
  }
  case 'repair-exceed': {
    // 1st: a small failing change. Repair: adds a huge file so the CUMULATIVE
    // diff blows the ceiling — the adapter must fail on the repair execution.
    const file = process.env.FAKE_CLAUDE_TARGET_FILE ?? 'src/button.js';
    const from = process.env.FAKE_CLAUDE_FROM ?? 'Save changes';
    if (run === 1) {
      const content = readFileSync(file, 'utf8');
      writeFileSync(file, content.replace(`label: '${from}'`, "label: ''"));
      printResult(`Set the label to empty in ${file}.`);
    } else {
      const lines = Array.from(
        { length: 400 },
        (_, i) => `const line${i} = ${i};`,
      );
      writeFileSync('generated-rewrite.js', lines.join('\n') + '\n');
      printResult('Rewrote a module during repair (400 lines).');
    }
    break;
  }
  case 'repair-cumulative': {
    // Isolates cumulative-vs-delta ceiling accounting. 1st: break the label and
    // add a modest filler file — under the ceiling, but checks FAIL. Repair:
    // FIX the label (checks pass) and append a few more filler lines. The repair
    // DELTA alone stays under the ceiling, so a delta-only measurement would let
    // the job succeed; only the CUMULATIVE diff (original filler + label edit +
    // repair filler) crosses it. Correct code must fail on the ceiling here.
    const file = process.env.FAKE_CLAUDE_TARGET_FILE ?? 'src/button.js';
    const from = process.env.FAKE_CLAUDE_FROM ?? 'Save changes';
    const to = process.env.FAKE_CLAUDE_TO ?? 'Submit changes';
    const content = readFileSync(file, 'utf8');
    if (run === 1) {
      writeFileSync(file, content.replace(`label: '${from}'`, "label: ''"));
      const lines = Array.from({ length: 18 }, (_, i) => `const a${i} = ${i};`);
      writeFileSync('filler.js', lines.join('\n') + '\n');
      printResult('Set the label to empty and added a filler module.');
    } else {
      writeFileSync(file, content.replace("label: ''", `label: '${to}'`));
      const extra = Array.from({ length: 12 }, (_, i) => `const b${i} = ${i};`);
      writeFileSync(
        'filler.js',
        readFileSync('filler.js', 'utf8') + extra.join('\n') + '\n',
      );
      printResult(
        `Repaired the label to ${JSON.stringify(to)} and extended filler.`,
      );
    }
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
