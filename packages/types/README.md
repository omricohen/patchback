# @patchback/types

Shared types for [Patchback](https://github.com/omricohen/patchback): the
contract every other package imports. Zero runtime dependencies.

- `FeedbackItem`, `CaptureContext`, `TriageResult` — the feedback data model.
- `TrustTier` (`owner` | `insider` | `outsider`) plus `canInitiatePatchJob()` —
  the trust boundary. Outsider feedback is data only, never agent input.
- `Job` and the canonical job state machine — every legal transition typed,
  every illegal transition throws:

```
feedback.received → feedback.triaged → feedback.needs_clarification | issue.created
  → patch.queued → patch.running → patch.failed | patch.generated
  → pr.opened → pr.reviewed → patch.shipped → feedback.closed
```

```ts
import { transitionJob, type Job } from '@patchback/types';

const next = transitionJob(job, 'patch.queued'); // throws on an illegal move
```

Part of the Patchback monorepo — see the
[root README](https://github.com/omricohen/patchback#readme) for the full
picture. MIT licensed.
