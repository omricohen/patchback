import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('@patchback/api', () => {
  it('is scaffolded', () => {
    expect(PACKAGE_NAME).toBe('@patchback/api');
  });
});
