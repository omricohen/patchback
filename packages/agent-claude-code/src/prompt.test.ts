import { describe, expect, it, vi } from 'vitest';

import type { RepoConventions } from '@patchback/agent-core';

import { buildPrompt } from './prompt.js';
import { labelChangeBrief, NEW_LABEL, OLD_LABEL } from './fixture.js';

const conventions: RepoConventions = {
  packageManager: 'pnpm',
  scripts: { lint: 'eslint .', test: 'vitest run' },
  docs: {
    agents: 'Always use pnpm.',
    contributing: 'Small PRs only.',
  },
};

describe('buildPrompt', () => {
  it('includes the brief: title, description, hints, criteria, constraints', () => {
    const brief = labelChangeBrief();
    const prompt = buildPrompt(brief, conventions, 300);
    expect(prompt).toContain(`# Task: ${brief.title}`);
    expect(prompt).toContain(OLD_LABEL);
    expect(prompt).toContain(NEW_LABEL);
    expect(prompt).toContain('- src/button.js');
    expect(prompt).toContain('- Only change the label text.');
    expect(prompt).toContain(`- The button label is "${NEW_LABEL}".`);
  });

  it('states the diff ceiling and the no-git-state-change rule', () => {
    const prompt = buildPrompt(labelChangeBrief(), undefined, 120);
    expect(prompt).toContain('under 120 changed lines');
    expect(prompt).toMatch(/do not run git commit/i);
    expect(prompt).toMatch(/minimal change/i);
  });

  it('includes repo conventions when provided', () => {
    const prompt = buildPrompt(labelChangeBrief(), conventions, 300);
    expect(prompt).toContain('Package manager: pnpm');
    expect(prompt).toContain('scripts: lint, test');
    expect(prompt).toContain('Always use pnpm.');
    expect(prompt).toContain('Small PRs only.');
  });

  it('omits the conventions section when absent', () => {
    const prompt = buildPrompt(labelChangeBrief(), undefined, 300);
    expect(prompt).not.toContain('Repository conventions');
  });
});

describe('buildPrompt — sourceHint section', () => {
  it('renders the hint ABOVE fileHints as primary-but-verify-first', () => {
    const prompt = buildPrompt(
      labelChangeBrief('src/button.js:3'),
      conventions,
      300,
    );
    expect(prompt).toContain('## Reported element source location');
    expect(prompt).toContain('`src/button.js:3`');
    expect(prompt).toContain('PRIMARY starting point');
    expect(prompt).toContain('VERIFY before editing');
    expect(prompt).toContain('not a trusted fact');
    expect(prompt).toMatch(/IGNORE the hint and locate the code by searching/);
    expect(prompt).toContain(
      'Never edit the hinted location on the strength of the hint alone.',
    );
    // Section ordering: hint section renders before the fileHints section.
    expect(prompt.indexOf('## Reported element source location')).toBeLessThan(
      prompt.indexOf('## Likely relevant files'),
    );
  });

  it('absent hint ⇒ byte-identical prompt to the v0.1 output (pin)', () => {
    const withHint = buildPrompt(
      labelChangeBrief('src/button.js:3'),
      conventions,
      300,
    );
    const withoutHint = buildPrompt(labelChangeBrief(), conventions, 300);
    expect(withoutHint).not.toContain('Reported element source location');
    // Removing the hint section from the with-hint prompt reproduces the
    // hint-less prompt EXACTLY — the section is purely additive.
    const stripped = withHint.replace(
      /## Reported element source location[\s\S]*?\n\n(?=## )/,
      '',
    );
    expect(stripped).toBe(withoutHint);
  });

  it('the factory guarantees a prompt never renders a hostile hint', () => {
    // An invalid hint is dropped BEFORE the brief exists; buildPrompt only
    // ever sees factory-validated values.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const brief = labelChangeBrief('/etc/passwd:1');
    warn.mockRestore();
    expect(brief.sourceHint).toBeUndefined();
    const prompt = buildPrompt(brief, conventions, 300);
    expect(prompt).not.toContain('/etc/passwd');
    expect(prompt).not.toContain('Reported element source location');
  });
});
