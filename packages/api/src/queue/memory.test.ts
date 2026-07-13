import { describe, expect, it } from 'vitest';

import { MemoryQueue } from './memory.js';
import { maxAttemptsForTask, type Task } from './queue.js';

describe('MemoryQueue', () => {
  it('delivers tasks in FIFO order, one at a time', async () => {
    const queue = new MemoryQueue();
    const seen: string[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;
    queue.process(async (task) => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 1));
      seen.push(task.type === 'triage' ? task.feedbackId : task.jobId);
      concurrent -= 1;
    });
    await queue.enqueue({ type: 'triage', feedbackId: 'a', jobId: 'ja' });
    await queue.enqueue({ type: 'triage', feedbackId: 'b', jobId: 'jb' });
    await queue.enqueue({ type: 'patch', jobId: 'jc' });
    await queue.onIdle();
    expect(seen).toEqual(['a', 'b', 'jc']);
    expect(maxConcurrent).toBe(1);
  });

  it('holds tasks enqueued before process() is registered', async () => {
    const queue = new MemoryQueue();
    await queue.enqueue({ type: 'triage', feedbackId: 'early', jobId: 'j1' });
    const seen: Task[] = [];
    queue.process(async (task) => {
      seen.push(task);
    });
    await queue.onIdle();
    expect(seen).toHaveLength(1);
  });

  it('retries failed triage tasks up to 3 attempts', async () => {
    const queue = new MemoryQueue();
    let attempts = 0;
    queue.process(async (task) => {
      if (task.type === 'triage') {
        attempts += 1;
        throw new Error('transport error');
      }
    });
    await queue.enqueue({ type: 'triage', feedbackId: 'x', jobId: 'jx' });
    await queue.onIdle();
    expect(attempts).toBe(3);
  });

  it('never retries patch tasks', async () => {
    const queue = new MemoryQueue();
    let attempts = 0;
    queue.process(async () => {
      attempts += 1;
      throw new Error('boom');
    });
    await queue.enqueue({ type: 'patch', jobId: 'j1' });
    await queue.onIdle();
    expect(attempts).toBe(1);
  });

  it('recovers after a failure and processes subsequent tasks', async () => {
    const queue = new MemoryQueue();
    const succeeded: string[] = [];
    queue.process(async (task) => {
      if (task.type === 'patch') {
        throw new Error('boom');
      }
      succeeded.push(task.feedbackId);
    });
    await queue.enqueue({ type: 'patch', jobId: 'j1' });
    await queue.enqueue({ type: 'triage', feedbackId: 'ok', jobId: 'j2' });
    await queue.onIdle();
    expect(succeeded).toEqual(['ok']);
  });

  it('onIdle resolves immediately when nothing is pending', async () => {
    const queue = new MemoryQueue();
    queue.process(async () => {});
    await expect(queue.onIdle()).resolves.toBeUndefined();
  });

  it('rejects double process() registration and enqueue after close', async () => {
    const queue = new MemoryQueue();
    queue.process(async () => {});
    expect(() => queue.process(async () => {})).toThrow(/only be called once/);
    await queue.close();
    await expect(
      queue.enqueue({ type: 'patch', jobId: 'late' }),
    ).rejects.toThrow(/closed/);
  });
});

describe('maxAttemptsForTask', () => {
  it('triage tasks get 3 attempts, patch tasks exactly 1', () => {
    expect(
      maxAttemptsForTask({ type: 'triage', feedbackId: 'f', jobId: 'j' }),
    ).toBe(3);
    expect(maxAttemptsForTask({ type: 'patch', jobId: 'j' })).toBe(1);
  });
});
