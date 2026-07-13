import { Queue, Worker, type ConnectionOptions } from 'bullmq';

import {
  maxAttemptsForTask,
  type Task,
  type TaskHandler,
  type TaskQueue,
} from './queue.js';

/**
 * Redis-backed TaskQueue via BullMQ — the prod driver, activated only when
 * explicitly configured. This is the ONLY file importing bullmq (vendor
 * confinement, same rule as anthropic.ts in the triage package).
 *
 * Retry semantics ride on per-job `attempts` from {@link maxAttemptsForTask}:
 * triage tasks retry with exponential backoff (transport failures), patch
 * tasks get exactly one attempt — the worker records `patch.failed` itself
 * and the queue never re-runs an agent on its own.
 */
export const DEFAULT_QUEUE_NAME = 'patchback';

export class BullMQQueue implements TaskQueue {
  private readonly queue: Queue;
  private worker: Worker | undefined;
  private readonly connection: ConnectionOptions;
  private readonly queueName: string;

  constructor(redisUrl: string, queueName: string = DEFAULT_QUEUE_NAME) {
    this.connection = connectionOptionsFromUrl(redisUrl);
    this.queueName = queueName;
    this.queue = new Queue(queueName, { connection: this.connection });
  }

  async enqueue(task: Task): Promise<void> {
    await this.queue.add(task.type, task, {
      attempts: maxAttemptsForTask(task),
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
      removeOnFail: 1000,
    });
  }

  process(handler: TaskHandler): void {
    if (this.worker !== undefined) {
      throw new Error('process() may only be called once');
    }
    this.worker = new Worker(
      this.queueName,
      async (job) => {
        await handler(job.data as Task);
      },
      { connection: this.connection, concurrency: 1 },
    );
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}

/**
 * Parse a redis:// / rediss:// URL into ioredis-shaped options without
 * importing ioredis directly (it is bullmq's dependency, not ours).
 */
export function connectionOptionsFromUrl(redisUrl: string): ConnectionOptions {
  const parsed = new URL(redisUrl);
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error(
      `unsupported Redis URL protocol: ${JSON.stringify(parsed.protocol)}`,
    );
  }
  const db = parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0;
  if (!Number.isInteger(db) || db < 0) {
    throw new Error(`invalid Redis database index in URL path`);
  }
  return {
    host: parsed.hostname,
    port: parsed.port === '' ? 6379 : Number(parsed.port),
    ...(parsed.username !== ''
      ? { username: decodeURIComponent(parsed.username) }
      : {}),
    ...(parsed.password !== ''
      ? { password: decodeURIComponent(parsed.password) }
      : {}),
    ...(db !== 0 ? { db } : {}),
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    // BullMQ workers require this to block on Redis streams indefinitely.
    maxRetriesPerRequest: null,
  };
}
