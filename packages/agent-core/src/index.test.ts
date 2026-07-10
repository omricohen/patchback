import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as agentCore from './index.js';

describe('@patchback/agent-core surface', () => {
  it('exports the adapter contract building blocks', () => {
    expect(agentCore.assertBriefSourceAllowed).toBeTypeOf('function');
    expect(agentCore.withScratchDir).toBeTypeOf('function');
    expect(agentCore.readRepoConventions).toBeTypeOf('function');
    expect(agentCore.detectChecks).toBeTypeOf('function');
    expect(agentCore.runChecks).toBeTypeOf('function');
    expect(agentCore.diffNumstat).toBeTypeOf('function');
  });

  it('stays vendor-neutral: no vendor SDK/CLI dependency in package.json', async () => {
    const packageJsonPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'package.json',
    );
    const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    });
    const vendorPattern = /anthropic|claude|openai|gemini|mistral|cohere/i;
    expect(allDeps.filter((dep) => vendorPattern.test(dep))).toEqual([]);
  });
});
