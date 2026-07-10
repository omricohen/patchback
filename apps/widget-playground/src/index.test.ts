import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('widget-playground', () => {
  it('is scaffolded', () => {
    expect(PACKAGE_NAME).toBe('widget-playground');
  });
});
