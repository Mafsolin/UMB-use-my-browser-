# Browser Capability Matrix

## Browser-Required

- Existing logged-in state matters
- Existing user tabs matter
- JS-rendered state matters
- Screenshot or DOM parity matters
- Anti-bot friction is likely
- The task depends on browser runtime state

## Static-Capable

- Public, stable documents
- Public docs pages with no auth or rendering dependency
- Questions answerable from ordinary web retrieval without loss of correctness

## Default

If in doubt and the user asked to use their browser, choose `browser-required`.
Do not downgrade a `browser-required` task to an active-tab-only method when UMB is unavailable.
