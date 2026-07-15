/**
 * Turn a `patch.failed` error string (produced by the pipeline / adapter /
 * check-runner) into a terminal-readable explanation with a next step.
 * Unrecognized errors pass through verbatim — never hidden.
 */

export interface FailureExplanation {
  /** One-line headline, e.g. `Lint failed in the target repo`. */
  headline: string;
  /** What to do about it. */
  advice: string;
  /** The raw error, for detail below the headline. */
  raw: string;
}

export function explainPatchFailure(
  error: string | undefined,
): FailureExplanation {
  const raw = error ?? 'unknown error';

  const checksMatch = /target repo checks failed: (.+)/.exec(raw);
  if (checksMatch !== null) {
    const failedList = checksMatch[1] ?? '';
    const names = ['lint', 'typecheck', 'test'].filter((name) =>
      new RegExp(`\\b${name}\\b`).test(failedList),
    );
    const which = names.length > 0 ? names.join(' and ') : 'checks';
    return {
      headline: `${capitalize(which)} failed in the target repo`,
      advice:
        'The agent made a change, but the target repo’s own checks rejected ' +
        'it, so no PR was opened. Run the failing check locally to see the ' +
        'output, and consider rephrasing the feedback or routing it to a human.',
      raw,
    };
  }

  if (/finished without changing any files|agent changed no files/i.test(raw)) {
    return {
      headline: 'The agent gave up without making a change',
      advice:
        'It could not find anything safe to change for this feedback. ' +
        'Rephrase the feedback more concretely (which page, which text, what ' +
        'should it say instead), or handle it manually.',
      raw,
    };
  }

  if (/Diff too large/i.test(raw)) {
    return {
      headline:
        'The agent’s change was too large — triage likely misjudged this item',
      advice:
        'A patchable item should be a small, focused change. Do not retry ' +
        'with a bigger limit; route this feedback to a human.',
      raw,
    };
  }

  if (/Could not spawn the Claude Code CLI/i.test(raw)) {
    return {
      headline: 'The Claude Code CLI is not available',
      advice:
        'Install Claude Code and make sure `claude` is on your PATH ' +
        '(https://docs.claude.com/en/docs/claude-code), then start the job again.',
      raw,
    };
  }

  if (/CLI (reported failure|timed out)/i.test(raw)) {
    return {
      headline: 'The agent gave up',
      advice:
        'The agent run ended without a usable change (details below). ' +
        'Check that ANTHROPIC_API_KEY is set and valid, then retry by ' +
        'starting the job again — or handle the feedback manually.',
      raw,
    };
  }

  if (
    /Authentication failed|could not read Username|could not read Password|Repository not found|Permission .* denied|git clone\b.*failed/i.test(
      raw,
    )
  ) {
    return {
      headline: 'Could not clone the target repository',
      advice:
        'The GitHub token could not clone the repo. Check the token’s ' +
        'repository access and Contents (read and write) permission — ' +
        '`patchback init` re-validates the token.',
      raw,
    };
  }

  if (/binary file/i.test(raw)) {
    return {
      headline: 'The change touched a binary file',
      advice:
        'Binary changes are not supported in v0.1 — this feedback needs a human.',
      raw,
    };
  }

  return {
    headline: 'Patch job failed',
    advice: 'The raw error is below; the feedback may need a human.',
    raw,
  };
}

/** Multi-line terminal rendering of an explanation. */
export function formatPatchFailure(error: string | undefined): string {
  const explanation = explainPatchFailure(error);
  return [
    `${explanation.headline}.`,
    `  ${explanation.advice}`,
    `  Raw error: ${explanation.raw}`,
  ].join('\n');
}

function capitalize(text: string): string {
  return text === '' ? text : text[0]?.toUpperCase() + text.slice(1);
}
