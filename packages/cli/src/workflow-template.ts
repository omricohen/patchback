/**
 * Renderer for the `.github/workflows/patchback.yml` that
 * `patchback init --github-action` scaffolds into a TARGET repo.
 *
 * The workflow is deliberately minimal and least-privilege:
 * - triggers on `issues: [labeled]`, filtered to the `patchback` label (a
 *   coarse trigger filter and CI-minutes saver ONLY — authorization is the
 *   HMAC marker the Action verifies, never the label);
 * - grants exactly `contents: write` + `issues: write` +
 *   `pull-requests: write` at the workflow level, which drops everything else
 *   to `none`;
 * - serializes per-issue via `concurrency` and bounds a stuck run with
 *   `timeout-minutes`.
 */

export interface WorkflowTemplateOptions {
  /** Label the ingest applies and the workflow filters on. Default `patchback`. */
  label?: string;
  /**
   * How the Action runs. `npx` pins to an exact published CLI version;
   * `action` uses the composite action ref. Default: `npx` at the given
   * `version`.
   */
  version?: string;
  /** Job timeout in minutes. Default 20. */
  timeoutMinutes?: number;
}

const DEFAULT_LABEL = 'patchback';
const DEFAULT_VERSION = '0.0.1';
const DEFAULT_TIMEOUT = 20;

export function renderWorkflow(options: WorkflowTemplateOptions = {}): string {
  const label = options.label ?? DEFAULT_LABEL;
  const version = options.version ?? DEFAULT_VERSION;
  const timeout = options.timeoutMinutes ?? DEFAULT_TIMEOUT;
  return `# Patchback — GitHub Action mode.
#
# Your ingest creates a patchback issue (with the marker + the "${label}" label);
# this workflow verifies the SIGNED marker and, if triage says patchable, opens
# a PR. It NEVER merges — PR review is the human gate.
#
# SECURITY: the "${label}" label only decides whether this workflow STARTS. It is
# NOT authorization. The Action verifies an HMAC marker inside the issue body;
# an unsigned/forged/tampered/stale marker neutral-exits with no agent run.
# Do not "harden" this by trusting the label.
name: Patchback

on:
  issues:
    types: [labeled]

# Least privilege: setting permissions at the workflow level drops every other
# scope to "none". Patchback needs exactly these three and nothing else.
permissions:
  contents: write # create the patch branch + commit (via the git data API)
  issues: write # comment the triage/patch outcome on the triggering issue
  pull-requests: write # open the PR (never merge)

# Serialize per issue so an opened+labeled double-fire (or a replay) cannot run
# twice at once; combined with the deterministic branch name this blocks a
# second PR from a replayed marker.
concurrency:
  group: patchback-\${{ github.event.issue.number }}
  cancel-in-progress: false

jobs:
  patchback:
    # Trigger filter only — the real gate is the HMAC marker inside the Action.
    if: github.event.label.name == '${label}'
    runs-on: ubuntu-latest
    timeout-minutes: ${timeout}
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      # Pinned to an exact published version so a security-critical path never
      # floats onto an unaudited CLI release.
      - run: npx --yes patchback@${version} ci
        shell: bash
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          PATCHBACK_SIGNING_SECRET: \${{ secrets.PATCHBACK_SIGNING_SECRET }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;
}
