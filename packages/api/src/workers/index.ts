import { resolvePipeline, validateConfig, type ApiConfig } from '../config.js';
import { runPatchTask } from './patch-worker.js';
import { runTriageTask } from './triage-worker.js';

/**
 * Register the queue consumers (triage + patch) against the same store/queue
 * the server uses. In dev, the CLI boots `buildServer` + `createWorkers` in
 * ONE process with MemoryStore + MemoryQueue; in prod the same workers run in
 * a separate process against Postgres + Redis. Nothing agent-related runs in
 * a request handler — all model/agent work happens here.
 */
export function createWorkers(config: ApiConfig): void {
  validateConfig(config);
  const pipeline = resolvePipeline(config);
  config.queue.process(async (task) => {
    if (task.type === 'triage') {
      await runTriageTask(config, task);
    } else {
      await runPatchTask(config, pipeline, task);
    }
  });
}
