/**
 * Parsing for `claude -p --output-format json` output.
 *
 * The CLI prints a single JSON object whose shape we treat as loosely as
 * possible: we only rely on `result` (the agent's final text) and
 * `is_error`/`subtype` when present. Unparsable output degrades to raw text —
 * the source of truth for whether the job worked is the git diff and the
 * check-runner, not the CLI's self-report.
 */

export interface ParsedCliResult {
  /** The agent's final text, or the raw output when JSON parsing failed. */
  resultText: string;
  /** True when the CLI reported an error (`is_error` or an error subtype). */
  isError: boolean;
  /** False when the output was not the expected JSON shape. */
  structured: boolean;
}

export function parseCliOutput(stdout: string): ParsedCliResult {
  const trimmed = stdout.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Some wrappers prepend log lines; try the last non-empty line.
    const lastLine = trimmed.split('\n').filter(Boolean).at(-1) ?? '';
    try {
      parsed = JSON.parse(lastLine);
    } catch {
      return { resultText: trimmed, isError: false, structured: false };
    }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { resultText: trimmed, isError: false, structured: false };
  }

  const record = parsed as Record<string, unknown>;
  const resultText =
    typeof record.result === 'string' ? record.result : trimmed;
  const isError =
    record.is_error === true ||
    (typeof record.subtype === 'string' && record.subtype.startsWith('error'));

  return { resultText, isError, structured: true };
}
