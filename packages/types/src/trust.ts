/**
 * Trust tiers are a security boundary, not a preference.
 *
 * - `owner` and `insider` feedback may initiate patch jobs.
 * - `outsider` feedback is data only: it must NEVER be passed to an agent as
 *   instructions — only stored/clustered. Enforced server-side.
 */
export const TRUST_TIERS = ['owner', 'insider', 'outsider'] as const;

export type TrustTier = (typeof TRUST_TIERS)[number];

/** Tiers whose feedback is allowed to initiate a patch job. */
export const PATCH_ELIGIBLE_TIERS = [
  'owner',
  'insider',
] as const satisfies readonly TrustTier[];

export function isTrustTier(value: unknown): value is TrustTier {
  return (
    typeof value === 'string' &&
    (TRUST_TIERS as readonly string[]).includes(value)
  );
}

/**
 * Whether feedback from this tier may initiate a patch job.
 * `outsider` always returns false — do not weaken this for convenience.
 */
export function canInitiatePatchJob(tier: TrustTier): boolean {
  return (
    (PATCH_ELIGIBLE_TIERS as readonly TrustTier[]).includes(tier) &&
    tier !== 'outsider'
  );
}
