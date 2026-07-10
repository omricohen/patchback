import { describe, expect, it } from 'vitest';

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
