import { describe, expect, it } from 'vitest';

import { explainPatchFailure, formatPatchFailure } from './failures.js';

describe('explainPatchFailure — readable failure headlines', () => {
  it('lint failed in the target repo', () => {
    const explanation = explainPatchFailure(
      'target repo checks failed: lint (npm run lint)',
    );
    expect(explanation.headline).toBe('Lint failed in the target repo');
    expect(explanation.advice).toContain('no PR was opened');
  });

  it('tests failed in the target repo', () => {
    const explanation = explainPatchFailure(
      'target repo checks failed: test (npm run test)',
    );
    expect(explanation.headline).toBe('Test failed in the target repo');
  });

  it('multiple failed checks are named together', () => {
    const explanation = explainPatchFailure(
      'target repo checks failed: lint (npm run lint), test (npm run test)',
    );
    expect(explanation.headline).toBe(
      'Lint and test failed in the target repo',
    );
  });

  it('checks still failed after a bounded repair attempt', () => {
    const explanation = explainPatchFailure(
      'target repo checks still failed after 1 automated repair attempt: ' +
        'test (npm run test). No PR was opened — route this feedback to a ' +
        'human.\n\nFailing checks BEFORE repair:\n### test — npm run test\n' +
        'boom\n\nFailing checks AFTER repair:\n### test — npm run test\nboom2',
    );
    expect(explanation.headline).toBe(
      'Test still failed after an automated repair',
    );
    expect(explanation.advice).toContain('one automated repair attempt');
    // Both check outputs stay in the raw detail.
    expect(explanation.raw).toContain('BEFORE repair');
    expect(explanation.raw).toContain('AFTER repair');
  });

  it('agent gave up: no changes', () => {
    const explanation = explainPatchFailure(
      'The agent finished without changing any files. Nothing to turn into a PR — the feedback may need clarification or a human.',
    );
    expect(explanation.headline).toContain('agent gave up');
    expect(explanation.advice).toContain('Rephrase');
  });

  it('agent gave up: CLI reported failure', () => {
    const explanation = explainPatchFailure(
      'Claude Code CLI reported failure (exit 1). Output tail:\nboom',
    );
    expect(explanation.headline).toBe('The agent gave up');
    expect(explanation.raw).toContain('boom');
  });

  it('diff ceiling exceeded routes to a human, not a retry', () => {
    const explanation = explainPatchFailure(
      'Diff too large: 512 changed lines across 9 file(s) exceeds the ceiling of 300. …',
    );
    expect(explanation.headline).toContain('too large');
    expect(explanation.advice).toContain('human');
    expect(explanation.advice).toContain('Do not retry');
  });

  it('missing Claude Code CLI gets an install hint', () => {
    const explanation = explainPatchFailure(
      'Could not spawn the Claude Code CLI ("claude"): spawn claude ENOENT. Is Claude Code installed and on PATH, or is binaryPath pointing at the right binary?',
    );
    expect(explanation.advice).toContain('PATH');
  });

  it('clone auth failures point at the token', () => {
    const explanation = explainPatchFailure(
      "git clone --quiet [redacted] /tmp/x failed (exit 128): fatal: Authentication failed for 'https://github.com/acme/webapp.git/'",
    );
    expect(explanation.headline).toContain('clone');
    expect(explanation.advice).toContain('token');
  });

  it('unknown errors pass through verbatim', () => {
    const explanation = explainPatchFailure('something nobody predicted');
    expect(explanation.headline).toBe('Patch job failed');
    expect(explanation.raw).toBe('something nobody predicted');
  });

  it('formatPatchFailure renders headline + advice + raw error', () => {
    const text = formatPatchFailure(
      'target repo checks failed: lint (npm run lint)',
    );
    expect(text).toContain('Lint failed in the target repo.');
    expect(text).toContain('Raw error: target repo checks failed');
  });
});
