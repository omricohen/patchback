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

/**
 * Sentinel the prompt asks the agent to print immediately before its
 * plain-language, non-technical summary line (see `buildPrompt`). Kept
 * distinctive so it never collides with ordinary prose. Extraction is
 * best-effort: if the agent omits or garbles it, no summary is produced.
 */
export const USER_SUMMARY_SENTINEL = '<<<PATCHBACK_USER_SUMMARY>>>';

/** Hard cap on the extracted user summary (a sentence or two, not an essay). */
export const USER_SUMMARY_MAX_LENGTH = 400;

/**
 * Pull the plain-language user summary out of the agent's final text. The
 * prompt asks for exactly one line of the form
 * `<<<PATCHBACK_USER_SUMMARY>>> one or two plain sentences`. We take the text
 * after the LAST occurrence of the sentinel (so a repair re-run's later
 * summary wins), up to the end of that line, trim it, and cap the length.
 *
 * Returns `undefined` when the sentinel is absent or the captured text is
 * empty — the field is optional and NEVER fabricated. This is the
 * best-effort, absent-safe contract the whole feature relies on.
 */
export function extractUserSummary(resultText: string): string | undefined {
  const marker = resultText.lastIndexOf(USER_SUMMARY_SENTINEL);
  if (marker === -1) {
    return undefined;
  }
  const afterSentinel = resultText.slice(marker + USER_SUMMARY_SENTINEL.length);
  // Only the sentinel's own line is the summary; ignore anything after a
  // newline (the prompt says nothing should follow, but be defensive).
  const firstLine = afterSentinel.split('\n', 1)[0] ?? '';
  const trimmed = firstLine.trim();
  if (trimmed === '') {
    return undefined;
  }
  return trimmed.length > USER_SUMMARY_MAX_LENGTH
    ? trimmed.slice(0, USER_SUMMARY_MAX_LENGTH).trimEnd()
    : trimmed;
}

/**
 * Remove the user-summary sentinel line(s) from the agent's raw text so the
 * machine sentinel never leaks into the technical PR body / logs. Everything
 * from the sentinel to the end of its line is dropped; other text is left
 * untouched. Absent sentinel ⇒ the text is returned unchanged.
 */
export function stripUserSummaryLine(resultText: string): string {
  if (!resultText.includes(USER_SUMMARY_SENTINEL)) {
    return resultText;
  }
  return resultText
    .split('\n')
    .filter((line) => !line.includes(USER_SUMMARY_SENTINEL))
    .join('\n')
    .replace(/\n+$/, '');
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
