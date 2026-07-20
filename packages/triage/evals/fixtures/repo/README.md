# Triage eval fixture repo

A tiny, entirely synthetic React/TypeScript app used ONLY by the retrieval
(stage-2) triage evals as a working copy for `LocalRepoProbe`. It contains no
client identifiers, real domains, or real people — generic UI (an orders table,
a settings page, a status badge). Not shipped in the published package (evals
live outside `dist`).

Specific string literals here (`Ammount Due`, `Notifcation Preferences`,
`Loading data`) are referenced by the retrieval fixtures in `../fixtures.json`
to exercise single-file (unambiguous) vs multi-file (ambiguous) matches.
