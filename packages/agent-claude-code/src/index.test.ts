import { describe, expect, expectTypeOf, it } from 'vitest';

import type { AgentAdapter } from '@patchback/agent-core';

import { createClaudeCodeAdapter, DEFAULT_MAX_CHANGED_LINES } from './index.js';

describe('@patchback/agent-claude-code surface', () => {
  it('exposes the adapter factory and the default ceiling', () => {
    expect(createClaudeCodeAdapter).toBeTypeOf('function');
    expect(DEFAULT_MAX_CHANGED_LINES).toBe(300);
  });

  it('implements the vendor-neutral AgentAdapter contract', () => {
    const adapter = createClaudeCodeAdapter();
    expectTypeOf(adapter).toMatchObjectType<AgentAdapter>();
    expect(adapter.name).toBe('claude-code');
    expect(adapter.prepare).toBeTypeOf('function');
    expect(adapter.plan).toBeTypeOf('function');
    expect(adapter.execute).toBeTypeOf('function');
    expect(adapter.summarize).toBeTypeOf('function');
  });
});
