import type { Store } from '@patchback/api';
import type {
  FeedbackItem,
  Job,
  JobState,
  TriageResult,
} from '@patchback/types';

import { formatPatchFailure } from './failures.js';

/**
 * Terminal streaming for `patchback dev`: the store is the single choke
 * point every state change flows through (routes AND workers), so a store
 * decorator streams the whole job pipeline without new API surface.
 *
 * Secret hygiene: every line AND every persisted job error/note passes
 * through `scrub` — the GitHub token can end up inside git error messages
 * (it is embedded in the clone URL), and those strings otherwise land in
 * the terminal and in `job.error` served over the API.
 */

export type LogSink = (line: string) => void;

export interface DevLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /** Replace every known secret in `text` with `[redacted]`. */
  scrub(text: string): string;
}

export interface CreateLoggerOptions {
  sink: LogSink;
  /** Secret values to redact from every line. */
  secrets?: readonly (string | undefined)[];
  /** ANSI colors (default false; the CLI enables it on a TTY). */
  color?: boolean;
  now?: () => Date;
}

const RESET = '\u001b[0m';
const DIM = '\u001b[2m';
const YELLOW = '\u001b[33m';
const RED = '\u001b[31m';

export function createDevLogger(options: CreateLoggerOptions): DevLogger {
  const secrets = (options.secrets ?? []).filter(
    (secret): secret is string => secret !== undefined && secret.length >= 8,
  );
  const color = options.color ?? false;
  const now = options.now ?? ((): Date => new Date());

  const scrub = (text: string): string => {
    let result = text;
    for (const secret of secrets) {
      result = result.split(secret).join('[redacted]');
    }
    return result;
  };
  const stamp = (): string => now().toISOString().slice(11, 19);
  const emit = (prefix: string, colorCode: string, message: string): void => {
    const time = color ? `${DIM}${stamp()}${RESET}` : stamp();
    const label =
      color && colorCode !== '' ? `${colorCode}${prefix}${RESET}` : prefix;
    for (const [index, line] of scrub(message).split('\n').entries()) {
      options.sink(
        index === 0 ? `${time} ${label} ${line}` : `         ${line}`,
      );
    }
  };

  return {
    info: (message) => emit('•', '', message),
    warn: (message) => emit('!', YELLOW, message),
    error: (message) => emit('✗', RED, message),
    scrub,
  };
}

const STATE_LABELS: Record<JobState, string> = {
  'feedback.received': 'Feedback received',
  'feedback.triaged': 'Triaged',
  'feedback.needs_clarification': 'Waiting for clarification',
  'issue.created': 'GitHub issue created',
  'patch.queued': 'Patch queued',
  'patch.running': 'Agent running',
  'patch.failed': 'Patch failed',
  'patch.generated': 'Patch generated',
  'pr.opened': 'PR opened',
  'pr.reviewed': 'PR reviewed',
  'patch.shipped': 'Patch shipped (merged)',
  'feedback.closed': 'Closed',
};

function short(id: string): string {
  return id.slice(0, 8);
}

function firstLine(message: string, cap = 80): string {
  const line = (message.split('\n')[0] ?? '').replace(
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f-\u009f]/g,
    ' ',
  );
  return line.length <= cap ? line : `${line.slice(0, cap - 1)}…`;
}

export interface InstrumentedStore extends Store {
  /** Every job id that passed through this store, in creation order. */
  readonly jobIds: readonly string[];
}

/**
 * Wrap a Store so feedback intake, triage verdicts, and every job state
 * transition stream to the logger — and so persisted error strings / history
 * notes are scrubbed of secrets BEFORE they hit storage (job errors are
 * served back over the API).
 */
export function instrumentStore(
  store: Store,
  logger: DevLogger,
): InstrumentedStore {
  const jobIds: string[] = [];
  const loggedHistory = new Map<string, number>();

  const scrubJob = (job: Job): Job => ({
    ...job,
    ...(job.error !== undefined ? { error: logger.scrub(job.error) } : {}),
    history: job.history.map((change) =>
      change.note !== undefined
        ? { ...change, note: logger.scrub(change.note) }
        : change,
    ),
  });

  const logNewHistory = (job: Job): void => {
    const seen = loggedHistory.get(job.id) ?? 0;
    for (const change of job.history.slice(seen)) {
      const label = STATE_LABELS[change.to] ?? change.to;
      const note = change.note !== undefined ? ` — ${change.note}` : '';
      logger.info(`job ${short(job.id)}: ${label} [${change.to}]${note}`);
    }
    loggedHistory.set(job.id, job.history.length);
    if (job.state === 'patch.failed') {
      logger.error(formatPatchFailure(job.error));
    }
    if (job.state === 'pr.opened' && job.prUrl !== undefined) {
      logger.info(
        `job ${short(job.id)}: review the PR at ${job.prUrl} — Patchback never merges.`,
      );
    }
  };

  return {
    jobIds,
    async createFeedback(item: FeedbackItem, readTokenHash: string) {
      await store.createFeedback(item, readTokenHash);
      logger.info(
        `feedback ${short(item.id)} received (tier: ${item.trustTier}): "${firstLine(item.message)}"`,
      );
    },
    getFeedback: (id) => store.getFeedback(id),
    async setTriage(id: string, triage: TriageResult) {
      await store.setTriage(id, triage);
      const question =
        triage.clarifyingQuestion !== undefined
          ? ` — question: ${firstLine(triage.clarifyingQuestion, 120)}`
          : '';
      logger.info(
        `triage ${short(id)}: ${triage.classification} (confidence ${triage.confidence})${question}`,
      );
    },
    listThread: (threadId) => store.listThread(threadId),
    verifyReadToken: (feedbackId, token) =>
      store.verifyReadToken(feedbackId, token),
    async createJob(job: Job) {
      const scrubbed = scrubJob(job);
      await store.createJob(scrubbed);
      jobIds.push(job.id);
      // The initial state has no history entry — announce it explicitly.
      logger.info(
        `job ${short(job.id)}: ${STATE_LABELS[job.state] ?? job.state} [${job.state}]`,
      );
      logNewHistory(scrubbed);
    },
    getJob: (id) => store.getJob(id),
    getJobByFeedbackId: (feedbackId) => store.getJobByFeedbackId(feedbackId),
    getJobByPrNumber: (prNumber) => store.getJobByPrNumber(prNumber),
    async updateJob(job: Job, expectedState: JobState) {
      const scrubbed = scrubJob(job);
      const swapped = await store.updateJob(scrubbed, expectedState);
      if (swapped) {
        logNewHistory(scrubbed);
      }
      return swapped;
    },
  };
}
