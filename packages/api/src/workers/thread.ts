import type { ThreadContext } from '@patchback/triage';
import type { FeedbackItem } from '@patchback/types';

import type { Store } from '../store/store.js';

/** Safety bound on ancestor walks — threads are shallow in practice. */
const MAX_THREAD_DEPTH = 20;

/**
 * Reconstruct the clarification-thread context for a reply item: ancestor
 * messages root-first, plus the clarifying question the reply answers (from
 * the immediate parent's triage). Returns undefined for root items.
 */
export async function buildThreadContext(
  store: Store,
  item: FeedbackItem,
): Promise<ThreadContext | undefined> {
  if (item.inReplyTo === undefined) {
    return undefined;
  }
  const ancestors: FeedbackItem[] = [];
  let clarifyingQuestion: string | undefined;
  let currentId: string | undefined = item.inReplyTo;
  while (currentId !== undefined && ancestors.length < MAX_THREAD_DEPTH) {
    const parent = await store.getFeedback(currentId);
    if (parent === undefined) {
      break;
    }
    if (ancestors.length === 0) {
      clarifyingQuestion = parent.triage?.clarifyingQuestion;
    }
    ancestors.push(parent);
    currentId = parent.inReplyTo;
  }
  ancestors.reverse(); // root first
  return {
    priorMessages: ancestors.map((ancestor) => ancestor.message),
    ...(clarifyingQuestion !== undefined ? { clarifyingQuestion } : {}),
  };
}
