import { canInitiatePatchJob, type TrustTier } from '@patchback/types';

/**
 * A structured task brief: the ONLY instruction channel into an agent.
 *
 * ## Trust boundary — read before touching this type
 *
 * Briefs are constructed exclusively by trusted code paths, from feedback that
 * triage classified `patchable` AND that came from a patch-eligible trust tier
 * (`owner` / `insider`). Content from `outsider` feedback must NEVER be placed
 * into any field of a brief — not the description, not the constraints, not
 * the file hints. Outsider feedback is data only: it may be stored and
 * clustered, but it is never instructions. Do not weaken this for convenience.
 *
 * {@link assertBriefSourceAllowed} is the defense-in-depth guard: call it with
 * the originating feedback's tier before building a brief.
 */
export interface TaskBrief {
  /** Short imperative title, e.g. `Change button label "Save" to "Submit"`. */
  title: string;
  /** What to change and why, in plain language. */
  description: string;
  /**
   * Hard constraints the agent must respect (e.g. "do not touch the API
   * package", "keep the diff minimal", "no new dependencies").
   */
  constraints: string[];
  /**
   * Repo-relative paths (or path fragments) likely involved. Hints, not a
   * whitelist — the agent may need to look elsewhere.
   */
  fileHints: string[];
  /** Observable criteria a reviewer will use to judge the change done. */
  acceptanceCriteria: string[];
  /** The FeedbackItem this brief was derived from, for the audit trail. */
  feedbackId?: string;
}

/** Thrown when code attempts to build a brief from a non-eligible trust tier. */
export class BriefSourceNotAllowedError extends Error {
  readonly tier: TrustTier;

  constructor(tier: TrustTier) {
    super(
      `Feedback from trust tier "${tier}" must never become agent instructions. ` +
        'Only owner/insider feedback may produce a task brief; outsider ' +
        'feedback is data only (stored/clustered, never executed).',
    );
    this.name = 'BriefSourceNotAllowedError';
    this.tier = tier;
  }
}

/**
 * Guard for the trust boundary: throws unless the originating feedback's tier
 * is allowed to initiate a patch job. Call this before constructing a
 * {@link TaskBrief} from feedback content.
 */
export function assertBriefSourceAllowed(tier: TrustTier): void {
  if (!canInitiatePatchJob(tier)) {
    throw new BriefSourceNotAllowedError(tier);
  }
}
