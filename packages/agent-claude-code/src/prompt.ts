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

  if (brief.sourceHint !== undefined) {
    lines.push(
      '## Reported element source location',
      'The user picked a UI element carrying a build-time source annotation:',
      `\`${brief.sourceHint}\` (file:line, relative to the repo root).`,
      '- Treat this as the PRIMARY starting point: open this file at this line first.',
      '- VERIFY before editing: confirm the code there actually renders the element the',
      '  feedback describes. The annotation is a hint from the page, not a trusted fact.',
      '- If the file does not exist, or the line does not correspond to the reported',
      '  element, IGNORE the hint and locate the code by searching the repository.',
      '  Never edit the hinted location on the strength of the hint alone.',
      '',
    );
  }

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
