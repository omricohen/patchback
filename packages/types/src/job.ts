/**
 * Canonical job state machine. This is the single source of truth — every
 * other package imports these states and MUST NOT define its own.
 *
 * feedback.received → feedback.triaged → feedback.needs_clarification | issue.created
 * issue.created → patch.queued → patch.running → patch.failed | patch.generated
 * patch.generated → pr.opened → pr.reviewed → patch.shipped → feedback.closed
 *
 * Invalid transitions throw. There is deliberately no transition into any
 * kind of auto-merge: `pr.reviewed` is reached only by human review.
 */
export const JOB_STATES = [
  'feedback.received',
  'feedback.triaged',
  'feedback.needs_clarification',
  'issue.created',
  'patch.queued',
  'patch.running',
  'patch.failed',
  'patch.generated',
  'pr.opened',
  'pr.reviewed',
  'patch.shipped',
  'feedback.closed',
] as const;

export type JobState = (typeof JOB_STATES)[number];

/** Every job starts here. */
export const INITIAL_JOB_STATE = 'feedback.received' satisfies JobState;

/**
 * Adjacency map of legal transitions. States mapping to an empty list are
 * terminal.
 */
export const JOB_STATE_TRANSITIONS: Readonly<
  Record<JobState, readonly JobState[]>
> = {
  'feedback.received': ['feedback.triaged'],
  'feedback.triaged': ['feedback.needs_clarification', 'issue.created'],
  'feedback.needs_clarification': [],
  'issue.created': ['patch.queued'],
  'patch.queued': ['patch.running'],
  'patch.running': ['patch.failed', 'patch.generated'],
  'patch.failed': [],
  'patch.generated': ['pr.opened'],
  'pr.opened': ['pr.reviewed'],
  'pr.reviewed': ['patch.shipped'],
  'patch.shipped': ['feedback.closed'],
  'feedback.closed': [],
};

export function isJobState(value: unknown): value is JobState {
  return (
    typeof value === 'string' &&
    (JOB_STATES as readonly string[]).includes(value)
  );
}

/** Legal next states from `from`. Empty for terminal states. */
export function nextJobStates(from: JobState): readonly JobState[] {
  return JOB_STATE_TRANSITIONS[from];
}

/** A state with no outgoing transitions. */
export function isTerminalJobState(state: JobState): boolean {
  return JOB_STATE_TRANSITIONS[state].length === 0;
}

export function canTransition(from: JobState, to: JobState): boolean {
  return JOB_STATE_TRANSITIONS[from].includes(to);
}

/** Thrown when a job is asked to make a transition the state machine forbids. */
export class InvalidJobTransitionError extends Error {
  readonly from: JobState;
  readonly to: JobState;

  constructor(from: JobState, to: JobState) {
    super(`Invalid job state transition: "${from}" → "${to}"`);
    this.name = 'InvalidJobTransitionError';
    this.from = from;
    this.to = to;
  }
}

/**
 * Validate a transition, throwing {@link InvalidJobTransitionError} if it is
 * not in the canonical map. Returns the new state so callers can assign it.
 */
export function assertTransition(from: JobState, to: JobState): JobState {
  if (!canTransition(from, to)) {
    throw new InvalidJobTransitionError(from, to);
  }
  return to;
}

/** One entry in a job's audit trail of state changes. */
export interface JobStateChange {
  from: JobState;
  to: JobState;
  /** ISO 8601 timestamp of when the transition happened. */
  at: string;
  /** Optional human-readable note (e.g. failure reason). */
  note?: string;
}

/**
 * A patch job: the lifecycle of one feedback item as it moves toward a PR.
 */
export interface Job {
  id: string;
  /** The FeedbackItem this job was created from. */
  feedbackId: string;
  state: JobState;
  /** Audit trail of every transition, oldest first. */
  history: JobStateChange[];
  /** GitHub issue number, set once `issue.created` is reached. */
  issueNumber?: number;
  /** Working branch name, set once the agent starts. */
  branchName?: string;
  /** PR number, set once `pr.opened` is reached. */
  prNumber?: number;
  /** Human-facing PR URL, set once `pr.opened` is reached. */
  prUrl?: string;
  /** Failure detail, set when the job reaches `patch.failed`. */
  error?: string;
  /** ISO 8601 timestamps. */
  createdAt: string;
  updatedAt: string;
}

/**
 * Return a copy of `job` moved to `to`, with `history` and `updatedAt`
 * maintained. Throws {@link InvalidJobTransitionError} on an illegal move.
 * Pure: the input job is not mutated.
 */
export function transitionJob(
  job: Job,
  to: JobState,
  options?: { at?: string; note?: string },
): Job {
  assertTransition(job.state, to);
  const at = options?.at ?? new Date().toISOString();
  const change: JobStateChange = { from: job.state, to, at };
  if (options?.note !== undefined) {
    change.note = options.note;
  }
  return {
    ...job,
    state: to,
    history: [...job.history, change],
    updatedAt: at,
  };
}
