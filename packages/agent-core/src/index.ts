/**
 * @patchback/agent-core — the vendor-neutral heart of the patch pipeline.
 *
 * Adapter interface (prepare/plan/execute/summarize), task briefs (the trust
 * boundary — see brief.ts), scratch-dir lifecycle, repo-reader, check-runner,
 * and local git plumbing. This package never imports a specific vendor SDK or
 * CLI — adapters like `@patchback/agent-claude-code` implement the interface
 * and are plugged in by the orchestrator.
 */
export * from './brief.js';
export * from './adapter.js';
export * from './scratch-dir.js';
export * from './repo-reader.js';
export * from './check-runner.js';
export * from './execute-with-repair.js';
export * from './git.js';
export * from './process.js';
