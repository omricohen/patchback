/**
 * Task queue seam. Two drivers:
 *
 * - `MemoryQueue` (memory.ts) — in-process FIFO, the dev default and the test
 *   driver. Zero dependencies, deterministic (one task at a time).
 * - `BullMQQueue` (bullmq.ts) — Redis-backed, the prod driver. The ONLY file
 *   importing bullmq.
 */

export type Task =
  | { type: 'triage'; feedbackId: string; jobId: string }
  | { type: 'patch'; jobId: string };

/**
 * Retry policy by task type, shared by both drivers:
 *
 * - `triage` tasks are retryable — a thrown `TriageModelError` is a transport
 *   failure (triage itself never retries by design).
 * - `patch` tasks are NEVER retried by the queue: a failed agent run moves
 *   the job to `patch.failed` for a human to look at. Re-running agents on
 *   queue retry would burn money and hide the failure.
 */
export function maxAttemptsForTask(task: Task): number {
  return task.type === 'triage' ? 3 : 1;
}

export type TaskHandler = (task: Task) => Promise<void>;

export interface TaskQueue {
  enqueue(task: Task): Promise<void>;
  /**
   * Single registration point; at-least-once delivery; a handler error
   * triggers retry per {@link maxAttemptsForTask}.
   */
  process(handler: TaskHandler): void;
  close(): Promise<void>;
}
