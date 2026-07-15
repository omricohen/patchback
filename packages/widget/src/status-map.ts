import type { JobState, TriageClassification } from '@patchback/types';

/**
 * Presentation map for the canonical job states. The server never invents
 * display vocabulary; this is the ONE place canonical states become labels.
 * `satisfies Record<JobState, …>` makes it compile-time exhaustive — a new
 * canonical state breaks the build here, which is the desired alarm.
 */
export type StatusTone =
  'neutral' | 'info' | 'progress' | 'attention' | 'warning' | 'success';

export interface StatusPresentation {
  label: string;
  tone: StatusTone;
  /** Animated chip (agent actively working). */
  pulse?: boolean;
}

export const STATUS_MAP = {
  'feedback.received': { label: 'Received', tone: 'neutral' },
  'feedback.triaged': { label: 'Triaged', tone: 'info' },
  'feedback.needs_clarification': {
    label: 'Question for you',
    tone: 'attention',
  },
  'issue.created': { label: 'Issue created', tone: 'progress' },
  'patch.queued': { label: 'Patch queued', tone: 'progress' },
  'patch.running': {
    label: 'Agent working on it…',
    tone: 'progress',
    pulse: true,
  },
  'patch.failed': {
    label: 'Automated patch failed — routed to a human',
    tone: 'warning',
  },
  'patch.generated': { label: 'Patch ready', tone: 'progress' },
  'pr.opened': { label: 'In review', tone: 'progress' },
  'pr.reviewed': { label: 'Review approved', tone: 'progress' },
  'patch.shipped': { label: 'Shipped', tone: 'success' },
  'feedback.closed': { label: 'Closed', tone: 'success' },
} as const satisfies Record<JobState, StatusPresentation>;

/**
 * Label for a state, refined by the triage classification where the state
 * alone is ambiguous (`feedback.triaged` covers both patchable and
 * needs_human).
 */
export function presentState(
  state: JobState,
  classification?: TriageClassification,
): StatusPresentation {
  const base: StatusPresentation = STATUS_MAP[state];
  if (state === 'feedback.triaged') {
    if (classification === 'patchable') {
      return { ...base, label: 'Triaged — ready for a patch' };
    }
    if (classification === 'needs_human') {
      return { ...base, label: 'Triaged — waiting for a human' };
    }
  }
  return base;
}
