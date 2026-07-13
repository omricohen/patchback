import {
  maxAttemptsForTask,
  type Task,
  type TaskHandler,
  type TaskQueue,
} from './queue.js';

interface PendingTask {
  task: Task;
  attempt: number;
}

/**
 * In-process FIFO queue — the dev default and the test driver.
 *
 * One task runs at a time (deterministic tests); failed tasks are re-enqueued
 * immediately up to `maxAttemptsForTask` attempts; `onIdle()` lets tests await
 * a full drain instead of sleeping. Tasks enqueued before `process()` is
 * called wait for the handler.
 */
export class MemoryQueue implements TaskQueue {
  private handler: TaskHandler | undefined;
  private readonly pending: PendingTask[] = [];
  private draining = false;
  private closed = false;
  private idleWaiters: Array<() => void> = [];

  async enqueue(task: Task): Promise<void> {
    if (this.closed) {
      throw new Error('queue is closed');
    }
    this.pending.push({ task, attempt: 1 });
    this.scheduleDrain();
  }

  process(handler: TaskHandler): void {
    if (this.handler !== undefined) {
      throw new Error('process() may only be called once');
    }
    this.handler = handler;
    this.scheduleDrain();
  }

  /**
   * Resolves once no task is running and none can progress: the queue is
   * empty, or no handler is registered yet (pending tasks cannot move).
   */
  onIdle(): Promise<void> {
    if (
      !this.draining &&
      (this.pending.length === 0 || this.handler === undefined)
    ) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.onIdle();
  }

  private scheduleDrain(): void {
    if (this.draining || this.handler === undefined) {
      return;
    }
    this.draining = true;
    queueMicrotask(() => {
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    const handler = this.handler;
    if (handler === undefined) {
      this.draining = false;
      return;
    }
    while (this.pending.length > 0) {
      const next = this.pending.shift();
      if (next === undefined) {
        break;
      }
      try {
        await handler(next.task);
      } catch {
        if (next.attempt < maxAttemptsForTask(next.task)) {
          this.pending.push({ task: next.task, attempt: next.attempt + 1 });
        }
        // Attempts exhausted: the task is dropped; the job rests where the
        // handler left it (e.g. feedback.received for a triage transport
        // failure) — never a fabricated classification or state.
      }
    }
    this.draining = false;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }
}
