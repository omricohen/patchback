import type { RepoConventions, TaskBrief } from '@patchback/agent-core';

/**
 * Build the headless prompt sent to the Claude Code CLI from a structured
 * task brief plus the target repo's conventions.
 *
 * Trust boundary reminder: briefs reaching this function were constructed by
 * trusted code from owner/insider feedback only (see agent-core brief.ts).
 * Never route raw outsider feedback text here.
 */
export function buildPrompt(
  brief: TaskBrief,
  conventions: RepoConventions | undefined,
  maxChangedLines: number,
): string {
  const lines: string[] = [
    'You are making a small, focused change in this repository on behalf of',
    'a reviewed feedback item. Work only inside the current directory.',
    '',
    `# Task: ${brief.title}`,
    '',
    brief.description,
    '',
  ];

  if (brief.fileHints.length > 0) {
    lines.push(
      '## Likely relevant files (hints, verify before editing)',
      ...brief.fileHints.map((hint) => `- ${hint}`),
      '',
    );
  }

  if (brief.acceptanceCriteria.length > 0) {
    lines.push(
      '## Acceptance criteria',
      ...brief.acceptanceCriteria.map((criterion) => `- ${criterion}`),
      '',
    );
  }

  lines.push('## Hard constraints');
  const constraints = [
    ...brief.constraints,
    `Keep the total diff under ${maxChangedLines} changed lines; if the task cannot be done that small, stop and explain instead of writing a large change.`,
    'Make the minimal change that satisfies the task. No drive-by refactors, no formatting sweeps, no new dependencies.',
    'Do NOT run git commit, git branch, git push, or any other git state change. Leave your edits uncommitted in the working tree.',
  ];
  lines.push(...constraints.map((constraint) => `- ${constraint}`), '');

  if (conventions !== undefined) {
    lines.push('## Repository conventions');
    lines.push(`- Package manager: ${conventions.packageManager}`);
    const scriptKeys = Object.keys(conventions.scripts);
    if (scriptKeys.length > 0) {
      lines.push(`- package.json scripts: ${scriptKeys.join(', ')}`);
    }
    if (conventions.docs.agents !== undefined) {
      lines.push('', '### Project agent notes', conventions.docs.agents);
    }
    if (conventions.docs.contributing !== undefined) {
      lines.push(
        '',
        '### CONTRIBUTING (excerpt)',
        conventions.docs.contributing,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}
