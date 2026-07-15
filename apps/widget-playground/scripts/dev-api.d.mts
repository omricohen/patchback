/** Hand-written declarations for the plain-JS dev harness (used by the
 * env-gated browser acceptance suite). */
import type { MemoryQueue, MemoryStore } from '@patchback/api';
import type { FastifyInstance } from 'fastify';

export declare const DEV_OWNER_KEY: string;
export declare const DEV_INSIDER_KEY: string;
export declare const DEV_WEBHOOK_SECRET: string;

export interface DevApi {
  app: FastifyInstance;
  store: MemoryStore;
  queue: MemoryQueue;
  github: unknown;
  address: string;
  createdFeedbackIds: string[];
  keys: { owner: string; insider: string };
  close(): Promise<void>;
}

export declare function createDevApi(options?: {
  port?: number;
  triageDelayMs?: number;
  patchDelayMs?: number;
}): Promise<DevApi>;
