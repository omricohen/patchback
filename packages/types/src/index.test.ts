import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('@patchback/types', () => {
  it('is scaffolded', () => {
    expect(PACKAGE_NAME).toBe('@patchback/types');
  });
});
