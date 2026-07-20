import { isTrustTier, type TrustTier } from '@patchback/types';

import { StoreIntegrityError } from './errors.js';

/**
 * Tier ordering for the thread minimum rule: owner > insider > outsider.
 * Lower rank = less trusted.
 */
const TIER_RANK: Readonly<Record<TrustTier, number>> = {
  outsider: 0,
  insider: 1,
  owner: 2,
};

/**
 * The MINIMUM tier across a set — used for clarification replies: a reply's
 * effective tier is the minimum across its whole thread (plus the caller),
 * so outsider content anywhere in a thread can never be laundered into a
 * triage prompt or a brief by a trusted replier.
 *
 * Fail closed: an empty set is `outsider`.
 */
export function minTrustTier(tiers: readonly TrustTier[]): TrustTier {
  let min: TrustTier = 'owner';
  if (tiers.length === 0) {
    return 'outsider';
  }
  for (const tier of tiers) {
    if (TIER_RANK[tier] < TIER_RANK[min]) {
      min = tier;
    }
  }
  return min;
}

/**
 * The tier-ceiling rule for token minting: is `requested` no more trusted than
 * `ceiling`? A minted browser token can never exceed its parent key's tier, so
 * the exchange endpoint mints iff `tierAtMost(requested, parentTier)`. Tier
 * ordering lives in exactly one place (this file's `TIER_RANK`).
 */
export function tierAtMost(requested: TrustTier, ceiling: TrustTier): boolean {
  return TIER_RANK[requested] <= TIER_RANK[ceiling];
}

/**
 * Runtime tier validation at a storage/config boundary. Returns the tier
 * when valid; throws {@link StoreIntegrityError} otherwise (fail closed —
 * never coerce an unknown value toward an eligible tier).
 */
export function assertTrustTier(value: unknown, context: string): TrustTier {
  if (!isTrustTier(value)) {
    throw new StoreIntegrityError(
      `${context}: invalid trust tier ${JSON.stringify(value)} — ` +
        'refusing to proceed (corruption or bad migration).',
    );
  }
  return value;
}
