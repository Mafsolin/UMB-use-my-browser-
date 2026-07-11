# Browser Playbook

## Intent

UMB is the live-browser path. Use it when correctness depends on the actual browser state.

## Browser-Only Policy

For browser-required work, operate only through the local UMB bridge and the user's real browser. Do not fall back to direct HTTP, search, static fetches, another browser, or active-tab-only tooling. Report the work as blocked when UMB is unavailable.

## Operating Sequence

1. Create or reuse a UMB session.
2. Enumerate tabs.
3. Decide whether to claim an existing tab or create a new one.
4. Navigate or inspect.
5. Snapshot before uncertain interactions.
6. Perform the smallest safe action.
7. Verify state after each meaningful action.
8. Finalize the session and keep only tabs that matter.

## Background Tab Discipline

- Prefer background reads for title, URL, DOM, and screenshot.
- Do not force focus unless the underlying capability requires it.
- If input must move to foreground, say so explicitly in the user-facing update.
- If the live UMB bridge is unavailable, stop and report that the browser-required path is blocked.
