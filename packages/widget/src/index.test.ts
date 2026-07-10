import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('@patchback/widget', () => {
  it('is scaffolded', () => {
    expect(PACKAGE_NAME).toBe('@patchback/widget');
  });
});
