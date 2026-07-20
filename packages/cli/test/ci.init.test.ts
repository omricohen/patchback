import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { runInitGithubAction } from '../src/init.js';
import { renderWorkflow } from '../src/workflow-template.js';

const tempDirs: string[] = [];
async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'patchback-ci-init-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function makeStreams(answers: string[]): {
  input: PassThrough;
  output: PassThrough;
  printed: () => string;
} {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(chunk));
  input.end(`${answers.join('\n')}\n`);
  return {
    input,
    output,
    printed: () => Buffer.concat(chunks).toString('utf8'),
  };
}

// --- A tiny YAML-subset parser, sufficient for the generated workflow. -------
// (No external YAML dependency in the offline gate.)
function indentOf(line: string): number {
  return line.length - line.replace(/^ +/, '').length;
}
function stripInlineComment(line: string): string {
  return line.replace(/\s+#.*$/, '');
}
function parseScalar(s: string): unknown {
  const t = s.trim();
  if (
    (t.startsWith("'") && t.endsWith("'")) ||
    (t.startsWith('"') && t.endsWith('"'))
  ) {
    return t.slice(1, -1);
  }
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+$/.test(t)) return Number(t);
  return t;
}
function parseScalarOrFlow(s: string): unknown {
  const t = s.trim();
  if (t.startsWith('[') && t.endsWith(']')) {
    const inner = t.slice(1, -1).trim();
    return inner === '' ? [] : inner.split(',').map((x) => parseScalar(x));
  }
  return parseScalar(t);
}
function parseYaml(src: string): Record<string, unknown> {
  const lines = src
    .split('\n')
    .filter((l) => l.trim() !== '' && !/^\s*#/.test(l))
    .map(stripInlineComment);
  let idx = 0;
  function parseBlock(indent: number): unknown {
    const content = lines[idx]?.slice(indent) ?? '';
    return content.startsWith('- ') || content === '-'
      ? parseList(indent)
      : parseMap(indent);
  }
  function parseMap(indent: number): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    while (idx < lines.length) {
      const line = lines[idx] as string;
      const ind = indentOf(line);
      if (ind < indent) break;
      const m = /^([^:]+):\s?(.*)$/.exec(line.slice(indent));
      if (m === null) throw new Error(`bad map line: ${line}`);
      const key = (m[1] as string).trim();
      const rest = m[2] as string;
      idx += 1;
      if (rest === '') {
        obj[key] =
          idx < lines.length && indentOf(lines[idx] as string) > indent
            ? parseBlock(indentOf(lines[idx] as string))
            : null;
      } else {
        obj[key] = parseScalarOrFlow(rest);
      }
    }
    return obj;
  }
  function parseList(indent: number): unknown[] {
    const arr: unknown[] = [];
    while (idx < lines.length) {
      const line = lines[idx] as string;
      if (indentOf(line) !== indent || !line.slice(indent).startsWith('- ')) {
        break;
      }
      // Rewrite the "- " prefix to two spaces so the item parses as a map at
      // indent+2, consuming its continuation lines.
      lines[idx] = ' '.repeat(indent + 2) + line.slice(indent + 2);
      arr.push(parseMap(indent + 2));
    }
    return arr;
  }
  return parseMap(0);
}

describe('renderWorkflow — least-privilege, HMAC-gated, no auto-merge', () => {
  it('parses and carries the exact security-critical structure', () => {
    const yaml = renderWorkflow();
    const doc = parseYaml(yaml) as {
      name: string;
      on: { issues: { types: string[] } };
      permissions: Record<string, string>;
      concurrency: { group: string; 'cancel-in-progress': boolean };
      jobs: { patchback: Record<string, unknown> };
    };

    expect(doc.name).toBe('Patchback');
    expect(doc.on.issues.types).toEqual(['labeled']);

    // EXACTLY the three write scopes — nothing else (least privilege).
    expect(doc.permissions).toEqual({
      contents: 'write',
      issues: 'write',
      'pull-requests': 'write',
    });

    expect(doc.concurrency.group).toContain('github.event.issue.number');
    expect(doc.concurrency['cancel-in-progress']).toBe(false);

    const job = doc.jobs.patchback;
    expect(job.if).toBe("github.event.label.name == 'patchback'");
    expect(job['runs-on']).toBe('ubuntu-latest');
    expect(job['timeout-minutes']).toBe(20);

    const steps = job.steps as Array<Record<string, unknown>>;
    const runStep = steps.find((s) => typeof s.run === 'string');
    expect(runStep?.run).toContain('npx --yes patchback@0.0.1 ci');
    expect(runStep?.env).toEqual({
      ANTHROPIC_API_KEY: '${{ secrets.ANTHROPIC_API_KEY }}',
      PATCHBACK_SIGNING_SECRET: '${{ secrets.PATCHBACK_SIGNING_SECRET }}',
      GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
    });

    // No auto-merge anywhere, ever — in the ACTIONABLE workflow (comments may
    // still say "never merges", which is the point).
    const actionable = yaml
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .map((l) => l.replace(/\s+#.*$/, ''))
      .join('\n');
    expect(actionable.toLowerCase()).not.toContain('merge');
  });

  it('respects a custom label and version', () => {
    const yaml = renderWorkflow({ label: 'pb-triage', version: '1.2.3' });
    const doc = parseYaml(yaml) as { jobs: { patchback: { if: string } } };
    expect(doc.jobs.patchback.if).toBe(
      "github.event.label.name == 'pb-triage'",
    );
    expect(yaml).toContain('npx --yes patchback@1.2.3 ci');
  });
});

describe('patchback init --github-action', () => {
  it('writes the workflow + config, prints the signing secret ONCE, writes NO secret file', async () => {
    const dir = await makeTempDir();
    const streams = makeStreams([
      'acme/webapp', // repo
      'main', // base branch
      'pnpm test', // test commands
    ]);
    const SECRET = 'deadbeefdeadbeefdeadbeefdeadbeef';
    const result = await runInitGithubAction({
      cwd: dir,
      input: streams.input,
      output: streams.output,
      signingSecret: SECRET,
    });

    // Config: settings present, secret absent.
    const config = await readFile(result.configPath, 'utf8');
    expect(config).toContain('repo: "acme/webapp"');
    expect(config).toContain('pnpm test');
    expect(config).not.toContain(SECRET);

    // Workflow: written, valid, secret NOT baked in.
    const workflow = await readFile(result.workflowPath, 'utf8');
    expect(result.workflowPath).toMatch(/\.github\/workflows\/patchback\.yml$/);
    expect(workflow).toContain('github.event.label.name');
    expect(workflow).not.toContain(SECRET);

    // The signing secret is printed ONCE and only in the terminal output.
    const printed = streams.printed();
    expect(printed).toContain(SECRET);
    expect(printed.split(SECRET)).toHaveLength(2); // exactly one occurrence
    expect(printed).toContain('gh secret set ANTHROPIC_API_KEY');
    expect(printed).toContain('gh secret set PATCHBACK_SIGNING_SECRET');

    // No .env was written.
    await expect(readFile(path.join(dir, '.env'), 'utf8')).rejects.toThrow();
  });

  it('refuses to overwrite an existing config without --force', async () => {
    const dir = await makeTempDir();
    const first = makeStreams(['acme/webapp', 'main', 'npm test']);
    await runInitGithubAction({
      cwd: dir,
      input: first.input,
      output: first.output,
      signingSecret: 'x'.repeat(32),
    });
    const second = makeStreams(['acme/webapp', 'main', 'npm test']);
    await expect(
      runInitGithubAction({
        cwd: dir,
        input: second.input,
        output: second.output,
      }),
    ).rejects.toThrow(/already exists/);
  });
});
