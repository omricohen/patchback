import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('@patchback/agent-core', () => {
  it('is scaffolded', () => {
    expect(PACKAGE_NAME).toBe('@patchback/agent-core');
  });
});
