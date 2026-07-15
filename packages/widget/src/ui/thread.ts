import type { FeedbackThreadResponse, JobStatusResponse } from '@patchback/sdk';

import { presentState } from '../status-map.js';
import { h, clear } from './dom.js';

/**
 * Thread view: the submitted message, triage badge, clarifying-question
 * callout, replies, live status chip, and the canonical-history timeline.
 *
 * The reply box renders ONLY at `feedback.needs_clarification` (the server
 * 409s otherwise — the widget mirrors the gate). "Start patch" renders
 * ONLY when an apiKey is configured AND the state/classification allow it;
 * the button is presentation, the server re-enforces everything.
 */
export interface ThreadViewState {
  thread?: FeedbackThreadResponse;
  status?: JobStatusResponse;
  /** True when the widget was configured with an API key. */
  hasApiKey: boolean;
  submittingReply: boolean;
  startingPatch: boolean;
  connectionLost: boolean;
  error?: string;
}

export interface ThreadViewActions {
  onReply(message: string): void;
  onStartPatch(): void;
  onNewFeedback(): void;
  onClose(): void;
}

export function renderThread(
  container: HTMLElement,
  state: ThreadViewState,
  actions: ThreadViewActions,
): void {
  clear(container);
  const children: Array<HTMLElement | undefined> = [];

  children.push(h('h2', {}, ['Your feedback']));

  const status = state.status;
  const thread = state.thread;
  const classification = latestClassification(state);
  if (status !== undefined) {
    const chip = presentState(status.state, classification);
    children.push(
      h(
        'div',
        {
          className: 'pb-row',
          'aria-live': 'polite',
        },
        [
          h(
            'span',
            {
              className: 'pb-chip',
              'data-tone': chip.tone,
              'data-state': status.state,
              'data-pulse': chip.pulse === true ? '' : undefined,
            },
            [chip.label],
          ),
          status.prUrl !== undefined
            ? h(
                'a',
                {
                  className: 'pb-pr-link',
                  href: status.prUrl,
                  target: '_blank',
                  rel: 'noreferrer noopener',
                },
                [`PR #${status.prNumber ?? ''}`],
              )
            : undefined,
        ].filter((c): c is HTMLElement => c !== undefined),
      ),
    );
  }

  if (state.connectionLost) {
    children.push(
      h('div', { className: 'pb-muted', role: 'status' }, [
        'Connection lost — retrying…',
      ]),
    );
  }

  if (thread !== undefined) {
    children.push(h('div', { className: 'pb-thread-msg' }, [thread.message]));
    for (const reply of thread.replies) {
      children.push(h('div', { className: 'pb-thread-msg' }, [reply.message]));
    }
    const question = latestClarifyingQuestion(state);
    if (
      question !== undefined &&
      status?.state === 'feedback.needs_clarification'
    ) {
      children.push(
        h('div', { className: 'pb-question' }, [
          h('strong', {}, ['Question: ']),
          question,
        ]),
      );
    }
  }

  // Reply box — only while awaiting clarification.
  if (status?.state === 'feedback.needs_clarification') {
    const replyBox = h('textarea', {
      'aria-label': 'Your answer',
      placeholder: 'Answer the question…',
    });
    const send = h(
      'button',
      {
        className: 'pb-btn pb-btn-primary',
        type: 'button',
        disabled: state.submittingReply,
      },
      [state.submittingReply ? 'Sending…' : 'Send answer'],
    );
    send.addEventListener('click', () => {
      if (replyBox.value.trim() !== '') {
        actions.onReply(replyBox.value);
      }
    });
    children.push(replyBox, h('div', { className: 'pb-row' }, [send]));
  }

  // Start patch — presentation only; every gate is server-side.
  if (
    state.hasApiKey &&
    status?.state === 'feedback.triaged' &&
    classification === 'patchable'
  ) {
    const start = h(
      'button',
      {
        className: 'pb-btn pb-btn-primary',
        type: 'button',
        disabled: state.startingPatch,
      },
      [state.startingPatch ? 'Starting…' : 'Start patch'],
    );
    start.addEventListener('click', () => actions.onStartPatch());
    children.push(h('div', { className: 'pb-row' }, [start]));
  }

  // Canonical history timeline.
  if (status !== undefined && status.history.length > 0) {
    const list = h('ol', { className: 'pb-history' });
    for (const change of status.history) {
      list.append(
        h('li', {}, [
          `${presentState(change.to, classification).label}` +
            (change.note !== undefined ? ` — ${change.note}` : ''),
        ]),
      );
    }
    children.push(list);
  }

  if (status?.state === 'patch.failed' && status.error !== undefined) {
    const details = h('details', {}, [
      h('summary', {}, ['Failure details']),
      h('div', { className: 'pb-muted' }, [status.error]),
    ]);
    children.push(details);
  }

  if (state.error !== undefined) {
    children.push(
      h('div', { className: 'pb-error', role: 'alert' }, [state.error]),
    );
  }

  const newFeedback = h('button', { className: 'pb-btn', type: 'button' }, [
    'New feedback',
  ]);
  newFeedback.addEventListener('click', () => actions.onNewFeedback());
  const close = h(
    'button',
    { className: 'pb-btn', type: 'button', 'aria-label': 'Close panel' },
    ['Close'],
  );
  close.addEventListener('click', () => actions.onClose());
  children.push(h('div', { className: 'pb-row' }, [newFeedback, close]));

  container.append(...children.filter((c) => c !== undefined));
}

function latestClassification(state: ThreadViewState) {
  const thread = state.thread;
  if (thread === undefined) {
    return undefined;
  }
  const activeJobId = state.status?.id;
  if (thread.job?.id === activeJobId) {
    return thread.triage?.classification;
  }
  for (const reply of thread.replies) {
    if (reply.jobId === activeJobId) {
      return reply.triage?.classification;
    }
  }
  return thread.triage?.classification;
}

function latestClarifyingQuestion(state: ThreadViewState): string | undefined {
  const thread = state.thread;
  if (thread === undefined) {
    return undefined;
  }
  const activeJobId = state.status?.id;
  if (thread.job?.id === activeJobId) {
    return thread.triage?.clarifyingQuestion;
  }
  for (const reply of thread.replies) {
    if (reply.jobId === activeJobId) {
      return reply.triage?.clarifyingQuestion;
    }
  }
  return thread.triage?.clarifyingQuestion;
}
