/**
 * A failure the CLI knows how to explain. `main()` prints `message` (no
 * stack trace) and exits 1 — every message must therefore be actionable on
 * its own: what went wrong, and what the user should do next.
 */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}
