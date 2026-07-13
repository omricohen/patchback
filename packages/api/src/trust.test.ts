import { describe, expect, it } from 'vitest';

import { StoreIntegrityError } from './errors.js';
import { assertTrustTier, minTrustTier } from './trust.js';

describe('minTrustTier (thread minimum rule)', () => {
  it('outsider anywhere wins: outsider root + insider reply → outsider', () => {
    expect(minTrustTier(['outsider', 'insider'])).toBe('outsider');
    expect(minTrustTier(['owner', 'insider', 'outsider'])).toBe('outsider');
  });

  it('insider < owner', () => {
    expect(minTrustTier(['owner', 'insider'])).toBe('insider');
    expect(minTrustTier(['owner', 'owner'])).toBe('owner');
  });

  it('fails closed on an empty set', () => {
    expect(minTrustTier([])).toBe('outsider');
  });
});

describe('assertTrustTier (storage/config boundary validation)', () => {
  it('returns valid tiers', () => {
    expect(assertTrustTier('owner', 'test')).toBe('owner');
    expect(assertTrustTier('insider', 'test')).toBe('insider');
    expect(assertTrustTier('outsider', 'test')).toBe('outsider');
  });

  it('throws StoreIntegrityError on anything else — never coerces', () => {
    for (const bad of ['admin', '', 'OWNER', 42, null, undefined, {}]) {
      expect(() => assertTrustTier(bad, 'test')).toThrow(StoreIntegrityError);
    }
  });
});
