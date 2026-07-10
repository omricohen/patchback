import { describe, expect, it } from 'vitest';

import {
  PATCH_ELIGIBLE_TIERS,
  TRIAGE_CLASSIFICATIONS,
  TRUST_TIERS,
  canInitiatePatchJob,
  isTriageClassification,
  isTrustTier,
  type CaptureContext,
  type FeedbackItem,
  type TriageResult,
} from './index.js';

describe('trust tiers', () => {
  it('are exactly owner | insider | outsider', () => {
    expect(TRUST_TIERS).toEqual(['owner', 'insider', 'outsider']);
  });

  it('only owner and insider may initiate patch jobs', () => {
    expect(PATCH_ELIGIBLE_TIERS).toEqual(['owner', 'insider']);
    expect(canInitiatePatchJob('owner')).toBe(true);
    expect(canInitiatePatchJob('insider')).toBe(true);
  });

  it('outsider can NEVER initiate a patch job', () => {
    expect(canInitiatePatchJob('outsider')).toBe(false);
    expect(PATCH_ELIGIBLE_TIERS).not.toContain('outsider');
  });

  it('isTrustTier narrows correctly', () => {
    for (const tier of TRUST_TIERS) {
      expect(isTrustTier(tier)).toBe(true);
    }
    expect(isTrustTier('admin')).toBe(false);
    expect(isTrustTier('Owner')).toBe(false);
    expect(isTrustTier(undefined)).toBe(false);
    expect(isTrustTier(1)).toBe(false);
  });
});

describe('triage classifications', () => {
  it('are exactly patchable | needs_clarification | needs_human', () => {
    expect(TRIAGE_CLASSIFICATIONS).toEqual([
      'patchable',
      'needs_clarification',
      'needs_human',
    ]);
  });

  it('isTriageClassification narrows correctly', () => {
    for (const c of TRIAGE_CLASSIFICATIONS) {
      expect(isTriageClassification(c)).toBe(true);
    }
    expect(isTriageClassification('auto_merge')).toBe(false);
    expect(isTriageClassification('')).toBe(false);
    expect(isTriageClassification(null)).toBe(false);
  });
});

describe('shared shapes compile and compose', () => {
  it('a full FeedbackItem with capture and triage type-checks', () => {
    const capture: CaptureContext = {
      url: 'https://app.example.test/orders',
      pageTitle: 'Orders',
      element: {
        domPath: 'main > table > thead > tr > th:nth-child(2)',
        tagName: 'th',
      },
      screenshot: { dataUri: 'data:image/png;base64,AAAA', masked: true },
      console: [
        {
          level: 'error',
          message: 'boom',
          timestamp: '2026-07-10T00:00:00.000Z',
        },
      ],
      viewport: { width: 1280, height: 800 },
      userAgent: 'test-agent',
      capturedAt: '2026-07-10T00:00:00.000Z',
    };
    const triage: TriageResult = {
      classification: 'patchable',
      confidence: 0.93,
      reasoning: 'Simple copy change.',
      triagedAt: '2026-07-10T00:00:01.000Z',
    };
    const item: FeedbackItem = {
      id: 'fb_1',
      message: 'The column header says "Data" but should say "Date".',
      trustTier: 'insider',
      submitter: { id: 'u_1', name: 'Test User' },
      capture,
      triage,
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:01.000Z',
    };
    expect(item.triage?.classification).toBe('patchable');
    expect(item.capture?.screenshot?.masked).toBe(true);
  });

  it('a minimal FeedbackItem (no capture, no triage) type-checks', () => {
    const item: FeedbackItem = {
      id: 'fb_2',
      message: 'Something feels off on this page.',
      trustTier: 'outsider',
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
    };
    expect(item.capture).toBeUndefined();
    expect(canInitiatePatchJob(item.trustTier)).toBe(false);
  });
});
