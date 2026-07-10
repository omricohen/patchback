import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('@patchback/react', () => {
  it('is scaffolded', () => {
    expect(PACKAGE_NAME).toBe('@patchback/react');
  });
});
