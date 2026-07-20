/**
 * Retrieval stage-2 pure logic: gating, query derivation (INPUT containment),
 * evidence rendering (OUTPUT containment), and the security-critical
 * reconciliation gate. Every function here is pure and IO-free — no model, no
 * filesystem — so the whole security envelope is unit-testable without either.
 *
 * The reconcile() gate is the load-bearing security boundary: the second model
 * call is ADVISORY. Independent of what the model says, reconcile enforces —
 *   - DOWN is always allowed;
 *   - UP is allowed by AT MOST ONE RUNG on the ladder
 *     needs_human < needs_clarification < patchable, and only when the probe
 *     evidence is unambiguous (a single file, few matches, not truncated,
 *     >= 1 match);
 *   - therefore needs_human can rise at most to needs_clarification and can
 *     NEVER reach patchable (two rungs) — guaranteed structurally, not by
 *     prompt.
 * The reconciled result is still passed through the existing demotion ladder
 * (`applyConfidenceThreshold`) by the caller, so the classify-down bias holds
 * end to end.
 */
import type { TriageClassification } from '@patchback/types';
import { parseSourceHint } from '@patchback/types';

import type { ProbeResult } from './probe.js';
import type { ParsedTriage } from './schema.js';

/**
 * Symmetric confidence band around the demotion threshold within which
 * `patchable` and `needs_human` items become probe-eligible. Default 0.15 ⇒
 * [0.55, 0.85] at the 0.7 threshold. Configurable via
 * `TriageOptions.retrievalBand`.
 */
export const DEFAULT_RETRIEVAL_BAND = 0.15;

/**
 * The `distinctFiles === 1` unambiguity rule also requires the total match
 * count to be at or below this cap — a string that appears many times even in
 * one file is not the "single obvious edit site" retrieval is allowed to
 * promote on. Configurable via `TriageOptions.maxUnambiguousMatches`.
 */
export const DEFAULT_MAX_UNAMBIGUOUS_MATCHES = 5;

/** Hard caps on the derived query set (constants, not knobs). */
export const MAX_QUERIES = 5;
export const MIN_QUERY_LEN = 4;
export const MAX_QUERY_LEN = 100;

/** Max files listed in the rendered evidence block (belt-and-braces cap). */
export const MAX_EVIDENCE_FILES = 20;

/**
 * Common single tokens that would match almost any repo — dropped so they
 * never become a query on their own. Case-insensitive.
 */
const QUERY_STOP_LIST: ReadonlySet<string> = new Set([
  'button',
  'error',
  'page',
  'the',
  'click',
  'link',
  'form',
  'input',
  'text',
  'label',
  'submit',
  'save',
]);

/**
 * The ladder ordering, shared with the demotion gate's implicit order.
 * `needs_human` is the floor (0); `patchable` is the ceiling (2).
 */
export const CLASSIFICATION_RUNG: Readonly<
  Record<TriageClassification, number>
> = {
  needs_human: 0,
  needs_clarification: 1,
  patchable: 2,
};

export function rung(classification: TriageClassification): number {
  return CLASSIFICATION_RUNG[classification];
}

/**
 * Which stage-1 results are eligible for a retrieval probe.
 *
 * Under the LITERAL one-rung rule (owner Decision A), `needs_human` is now
 * probe-eligible (it may rise one rung to `needs_clarification`). Gating:
 *  - `needs_clarification` — ALWAYS eligible (the primary recovery target);
 *  - `patchable` and `needs_human` — eligible only when the model's confidence
 *    sits inside the band around the threshold. A confidently-`patchable` item
 *    above the band, and a confidently-`needs_human` item above the band, are
 *    "obviously settled" and are NOT probed (saves a call and a laundering
 *    surface). This preserves the plan's "avoid probing obviously-settled
 *    items" while admitting `needs_human` per Decision A.
 */
export function isBorderline(
  stage1: ParsedTriage,
  threshold: number,
  band: number,
): boolean {
  if (stage1.classification === 'needs_clarification') {
    return true;
  }
  return (
    stage1.confidence >= threshold - band &&
    stage1.confidence <= threshold + band
  );
}

/** Extract single/double/smart-quoted and backtick-quoted phrases. */
function extractQuotedPhrases(message: string): string[] {
  const phrases: string[] = [];
  const patterns = [
    /'([^']+)'/g, // straight single
    /"([^"]+)"/g, // straight double
    /`([^`]+)`/g, // backtick
    /‘([^’]+)’/g, // smart single ‘ ’
    /“([^”]+)”/g, // smart double “ ”
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(message)) !== null) {
      if (match[1] !== undefined) {
        phrases.push(match[1]);
      }
    }
  }
  return phrases;
}

/**
 * Derive fixed-string search queries from capture — INPUT containment.
 *
 * Sources (priority order): the validated `sourceHint` file path, the picked
 * element's visible text, then quoted phrases from the message. Every query is
 * a plain search STRING — it is never interpreted as a regex, glob, or shell
 * argument by any conforming probe. Pure and deterministic: same item ⇒ same
 * queries, so evals are reproducible.
 */
export function deriveProbeQueries(
  message: string,
  element?: { text?: string; sourceHint?: string },
): string[] {
  const candidates: string[] = [];

  if (element?.sourceHint) {
    const parsed = parseSourceHint(element.sourceHint);
    if (parsed) {
      // The validated repo-relative path. A content-search probe treats it as
      // just another literal; a path-aware probe may use it to locate the file.
      candidates.push(parsed.file);
    }
  }
  if (element?.text) {
    candidates.push(element.text);
  }
  candidates.push(...extractQuotedPhrases(message));

  const seen = new Set<string>();
  const queries: string[] = [];
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (trimmed.length < MIN_QUERY_LEN || trimmed.length > MAX_QUERY_LEN) {
      continue; // too common, or (over-long) unsafe to truncate a literal
    }
    // Drop pure punctuation/whitespace and single stop-list tokens.
    if (!/[A-Za-z0-9]/.test(trimmed)) {
      continue;
    }
    if (!trimmed.includes(' ') && QUERY_STOP_LIST.has(trimmed.toLowerCase())) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    queries.push(trimmed);
    if (queries.length >= MAX_QUERIES) {
      break;
    }
  }
  return queries;
}

/**
 * The unambiguity gate on probe evidence: the referenced string resolves to
 * exactly ONE file, with at least one and at most `maxMatches` matches, and the
 * probe did not truncate. Anything else (multi-file, zero-match, too-many, or
 * truncated) is ambiguous and can NEVER grant an up-move.
 */
export function isUnambiguous(
  probe: ProbeResult,
  maxMatches: number = DEFAULT_MAX_UNAMBIGUOUS_MATCHES,
): boolean {
  return (
    !probe.truncated &&
    probe.totalMatches >= 1 &&
    probe.distinctFiles.length === 1 &&
    probe.totalMatches <= maxMatches
  );
}

export interface ReconcileOptions {
  maxUnambiguousMatches?: number;
}

/**
 * Reconcile stage-1 and the advisory stage-2 verdict against the probe
 * evidence. PURE and independent of the model's raw output.
 *
 * Rules (see module header): DOWN always honoured; UP allowed only by exactly
 * one rung AND only when `isUnambiguous`; everything else clamps back to
 * stage1. The one-rung cap is enforced by `r2 - r1 === 1`, so a two-rung jump
 * (e.g. `needs_human → patchable`) can never pass — the result for a
 * `needs_human` stage1 is only ever `needs_human` or `needs_clarification`,
 * never `patchable`.
 */
export function reconcile(
  stage1: ParsedTriage,
  stage2: ParsedTriage,
  probe: ProbeResult,
  options: ReconcileOptions = {},
): ParsedTriage {
  const maxMatches =
    options.maxUnambiguousMatches ?? DEFAULT_MAX_UNAMBIGUOUS_MATCHES;
  const r1 = rung(stage1.classification);
  const r2 = rung(stage2.classification);

  const annotate = (base: ParsedTriage, note: string): ParsedTriage => ({
    ...base,
    reasoning: `${base.reasoning} [stage2/retrieval: ${note}]`,
  });

  // Always allow DOWN (or a same-rung confirm) — retrieval that reduces or
  // confirms confidence is honoured unconditionally.
  if (r2 <= r1) {
    return annotate(stage2, r2 < r1 ? 'lowered' : 'confirmed');
  }

  // r2 > r1: an UP move is requested. Permit ONLY exactly one rung, and ONLY
  // under strict unambiguity. Everything else clamps back to stage1.
  const oneRung = r2 - r1 === 1;
  const unambiguous = isUnambiguous(probe, maxMatches);
  if (oneRung && unambiguous) {
    return annotate(
      stage2,
      `raised ${stage1.classification}→${stage2.classification}, single-file unambiguous match`,
    );
  }

  const reason = !oneRung
    ? 'up-move vetoed — more than one rung requested'
    : 'up-move vetoed — ambiguous or capped evidence';
  return annotate(stage1, reason);
}

/**
 * Render probe evidence for the second model call — OUTPUT containment.
 *
 * Owner Decision B: PATHS + MATCH-COUNTS ONLY. No file contents, no match-line
 * snippets. Query strings are referenced by INDEX (not echoed), so the block's
 * entire content is repo-tree paths (already shape-constrained, filesystem-
 * derived, not submitter text) and non-negative integers — structurally
 * incapable of carrying attacker-controlled prose. The caller still wraps this
 * in a nonce-delimited DATA block and runs it through `sanitizeDataContent`.
 */
export function renderProbeEvidence(probe: ProbeResult): string {
  const lines: string[] = [
    `summary: distinctFiles=${probe.distinctFiles.length} totalMatches=${probe.totalMatches} truncated=${probe.truncated}`,
  ];
  let filesListed = 0;
  let capped = false;
  for (let index = 0; index < probe.perQuery.length && !capped; index += 1) {
    const entry = probe.perQuery[index]!;
    if (entry.files.length === 0) {
      lines.push(`query ${index + 1}: (no matches)`);
      continue;
    }
    for (const file of entry.files) {
      if (filesListed >= MAX_EVIDENCE_FILES) {
        lines.push('(evidence list capped)');
        capped = true;
        break;
      }
      lines.push(`query ${index + 1}: ${file.path} • ${file.count}`);
      filesListed += 1;
    }
  }
  return lines.join('\n');
}
