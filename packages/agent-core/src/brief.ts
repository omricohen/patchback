import {
  canInitiatePatchJob,
  formatSourceHint,
  parseSourceHint,
  type FeedbackItem,
  type TriageClassification,
  type TrustTier,
} from '@patchback/types';

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
 * The guard is structural: adapters take a {@link GuardedTaskBrief}, which is
 * branded so it cannot be object-literal-constructed — the ONLY producer is
 * {@link createBriefFromTriagedFeedback}, which enforces both preconditions
 * (patch-eligible tier AND `patchable` triage classification) and stamps the
 * audit fields. {@link assertBriefSourceAllowed} remains the underlying tier
 * check, called inside the factory.
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
  /**
   * Build-provenance location (`relative/file.tsx:line`) of the UI element
   * the feedback was reported against. Page-controlled data at origin: the
   * factory re-validates with `parseSourceHint` and DROPS invalid values,
   * so a brief that carries this field carries a shape-clean relative path.
   * Still a hint to VERIFY, never an instruction — prompts must say so.
   */
  sourceHint?: string;
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
 * is allowed to initiate a patch job. Called inside
 * {@link createBriefFromTriagedFeedback}; exposed for defense-in-depth checks
 * at other layers.
 */
export function assertBriefSourceAllowed(tier: TrustTier): void {
  if (!canInitiatePatchJob(tier)) {
    throw new BriefSourceNotAllowedError(tier);
  }
}

/**
 * Thrown when code attempts to build a brief from feedback that triage did
 * not classify `patchable`. Triage before code: only `patchable` items may
 * start a patch job.
 */
export class BriefNotPatchableError extends Error {
  /** The item's actual classification, or undefined if it was never triaged. */
  readonly classification: TriageClassification | undefined;

  constructor(classification: TriageClassification | undefined) {
    super(
      classification === undefined
        ? 'Feedback has not been triaged; only feedback classified ' +
            '"patchable" may become a task brief.'
        : `Feedback classified "${classification}" must never become a task ` +
            'brief; only "patchable" items may start a patch job.',
    );
    this.name = 'BriefNotPatchableError';
    this.classification = classification;
  }
}

declare const briefFromTriagedFeedback: unique symbol;

/**
 * A TaskBrief that provably went through {@link createBriefFromTriagedFeedback}.
 *
 * The unique-symbol brand makes object-literal construction a type error
 * anywhere outside this module — the factory is the only producer. Adapters
 * (via `AgentContext`) require this type, so an orchestrator cannot hand an
 * agent a brief that skipped the tier + triage checks.
 */
export interface GuardedTaskBrief extends TaskBrief {
  /** The FeedbackItem this brief was derived from (always stamped). */
  readonly feedbackId: string;
  /** Trust tier of the originating feedback, for the audit trail. */
  readonly sourceTier: TrustTier;
  readonly [briefFromTriagedFeedback]: true;
}

/**
 * The ONLY way to turn triaged feedback into a brief an agent will accept.
 *
 * Preconditions (both enforced, in this order):
 * 1. `canInitiatePatchJob(item.trustTier)` — otherwise
 *    {@link BriefSourceNotAllowedError}. Outsider feedback is data only.
 * 2. `item.triage?.classification === 'patchable'` — otherwise
 *    {@link BriefNotPatchableError}. Triage before code.
 *
 * Stamps `feedbackId` and `sourceTier` from the item; callers supply the
 * remaining brief fields.
 *
 * `sourceHint` is additionally re-validated here — the factory is the
 * AUTHORITATIVE gate for it (guarded-brand design: no caller can smuggle an
 * unvalidated hint past this function). Invalid hints are dropped, with a
 * warning, and the brief proceeds hint-less: a hostile build stamp must
 * never DoS the patch pipeline.
 */
export function createBriefFromTriagedFeedback(
  item: FeedbackItem,
  fields: Omit<TaskBrief, 'feedbackId'>,
): GuardedTaskBrief {
  assertBriefSourceAllowed(item.trustTier);
  if (item.triage?.classification !== 'patchable') {
    throw new BriefNotPatchableError(item.triage?.classification);
  }
  const { sourceHint: rawSourceHint, ...rest } = fields;
  let sourceHint: string | undefined;
  if (rawSourceHint !== undefined) {
    const parsed = parseSourceHint(rawSourceHint);
    if (parsed !== undefined) {
      sourceHint = formatSourceHint(parsed);
    } else {
      console.warn(
        'patchback: dropped invalid sourceHint from brief for feedback ' +
          `${item.id} (page-controlled value failed validation)`,
      );
    }
  }
  const brief: Omit<GuardedTaskBrief, typeof briefFromTriagedFeedback> = {
    ...rest,
    ...(sourceHint !== undefined ? { sourceHint } : {}),
    feedbackId: item.id,
    sourceTier: item.trustTier,
  };
  return brief as GuardedTaskBrief;
}
