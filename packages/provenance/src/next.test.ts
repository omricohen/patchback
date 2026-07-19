import { describe, expect, it } from 'vitest';

import { withPatchbackProvenance } from './next.js';

const DEV_PHASE = 'phase-development-server';
const BUILD_PHASE = 'phase-production-build';

describe('withPatchbackProvenance', () => {
  it('injects the repo root env in the DEV phase only', async () => {
    const wrapped = withPatchbackProvenance(
      { reactStrictMode: true },
      { root: '/custom/root' },
    );
    const dev = await wrapped(DEV_PHASE, {});
    expect(dev.reactStrictMode).toBe(true);
    expect(dev.env).toEqual({ PATCHBACK_PROVENANCE_ROOT: '/custom/root' });

    const build = await wrapped(BUILD_PHASE, {});
    expect(build.env).toBeUndefined();
    expect(build.reactStrictMode).toBe(true);
  });

  it('discovers the nearest .git ancestor when no root option is given', async () => {
    const wrapped = withPatchbackProvenance();
    const dev = await wrapped(DEV_PHASE, {});
    const injected = dev.env?.PATCHBACK_PROVENANCE_ROOT;
    expect(typeof injected).toBe('string');
    // Running inside this repo: the discovered root is the repo root.
    expect(injected?.endsWith('patchback')).toBe(true);
  });

  it('preserves existing env entries and supports function configs', async () => {
    const wrapped = withPatchbackProvenance(
      (phase) => ({ env: { OTHER: 'x' }, phaseSeen: phase }),
      { root: '/r' },
    );
    const dev = await wrapped(DEV_PHASE, {});
    expect(dev.env).toEqual({
      OTHER: 'x',
      PATCHBACK_PROVENANCE_ROOT: '/r',
    });
    expect(dev.phaseSeen).toBe(DEV_PHASE);
  });
});
