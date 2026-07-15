import { describe, expect, it } from 'vitest';

import { JOB_STATES } from '@patchback/types';

import { presentState, STATUS_MAP } from './status-map.js';

describe('status presentation map', () => {
  it('covers every canonical state (also compile-enforced via satisfies)', () => {
    for (const state of JOB_STATES) {
      const presentation = STATUS_MAP[state];
      expect(presentation.label.length).toBeGreaterThan(0);
      expect(presentation.tone.length).toBeGreaterThan(0);
    }
    expect(Object.keys(STATUS_MAP).sort()).toEqual([...JOB_STATES].sort());
  });

  it('pins the label/tone vocabulary', () => {
    expect(STATUS_MAP['feedback.needs_clarification']).toEqual({
      label: 'Question for you',
      tone: 'attention',
    });
    expect(STATUS_MAP['patch.running']).toEqual({
      label: 'Agent working on it…',
      tone: 'progress',
      pulse: true,
    });
    expect(STATUS_MAP['patch.failed'].tone).toBe('warning');
    expect(STATUS_MAP['patch.shipped'].tone).toBe('success');
    expect(STATUS_MAP['feedback.closed'].tone).toBe('success');
  });

  it('refines feedback.triaged by classification', () => {
    expect(presentState('feedback.triaged', 'patchable').label).toBe(
      'Triaged — ready for a patch',
    );
    expect(presentState('feedback.triaged', 'needs_human').label).toBe(
      'Triaged — waiting for a human',
    );
    expect(presentState('feedback.triaged').label).toBe('Triaged');
    expect(presentState('patch.queued', 'patchable').label).toBe(
      'Patch queued',
    );
  });
});
